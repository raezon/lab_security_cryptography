package main

// Visionneuse de buckets MinIO (cours MinIO + page « Au repos ») :
//   - GET /api/minio/buckets : buckets, chiffrement SSE, versioning, Object Lock, objets ;
//   - GET /api/minio/object  : un objet vu par l'API S3 (utilisateur autorisé) ET
//     lu directement sur le disque du conteneur MinIO (voleur de disque).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"regexp"
	"strings"
)

const mcAlias = `mc alias set demo https://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null || exit 1
`

func handleBuckets(w http.ResponseWriter, r *http.Request) {
	script := mcAlias + `mc ls --json demo | jq -r 'select(.type=="folder")|.key' | sed 's#/$##' | while read -r b; do
  enc=$(mc encrypt info --json "demo/$b" 2>/dev/null | jq -r '.encryption.algorithm // empty')
  ver=$(mc version info --json "demo/$b" 2>/dev/null | jq -r '.versioning.status // empty')
  lock=$(mc retention info --default --json "demo/$b" 2>/dev/null | jq -c 'select(.status=="success")')
  objs=$(mc ls --recursive --json "demo/$b" 2>/dev/null | head -n 200 | jq -s -c '[.[]|select(.type=="file")|{key,size,lastModified}]')
  n=$(mc ls --recursive "demo/$b" 2>/dev/null | wc -l)
  jq -n -c --arg b "$b" --arg e "$enc" --arg v "$ver" --argjson l "${lock:-null}" --argjson o "${objs:-[]}" --argjson n "${n:-0}" \
    '{name:$b, encryption:$e, versioning:$v, lock:$l, objects:$o, count:$n}'
done | jq -s -c .`
	out, code, err := docker.ExecOutput(r.Context(), toolbox, labEnv(), script)
	if err == nil && code != 0 {
		err = fmt.Errorf("mc : %s", truncate(out, 400))
	}
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	var res []map[string]any
	if jerr := json.Unmarshal([]byte(strings.TrimSpace(out)), &res); jerr != nil {
		writeJSON(w, nil, fmt.Errorf("réponse mc illisible : %s", truncate(out, 300)))
		return
	}
	writeJSON(w, res, nil)
}

var (
	reBucket = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,62}$`)
	reKey    = regexp.MustCompile(`^[A-Za-z0-9._/ =-]{1,300}$`)
)

func handleObject(w http.ResponseWriter, r *http.Request) {
	b, k := r.URL.Query().Get("bucket"), r.URL.Query().Get("key")
	if !reBucket.MatchString(b) || !reKey.MatchString(k) || strings.Contains(k, "..") {
		writeJSON(w, nil, fmt.Errorf("bucket ou objet invalide"))
		return
	}
	ctx := r.Context()
	env := append(labEnv(), "B="+b, "K="+k)
	out, code, err := docker.ExecOutput(ctx, toolbox, env, mcAlias+`mc stat --json "demo/$B/$K"; echo '@@@CONTENU@@@'; mc cat "demo/$B/$K" | head -c 1500`)
	if err == nil && code != 0 {
		err = fmt.Errorf("mc : %s", truncate(out, 400))
	}
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	statJSON, content, _ := strings.Cut(out, "@@@CONTENU@@@\n")
	var stat map[string]any
	json.Unmarshal([]byte(strings.TrimSpace(statJSON)), &stat)

	res := map[string]any{"bucket": b, "key": k, "stat": stat, "content": content}
	// Sur le disque : <bucket>/<clé>/xl.meta (petit objet, données inline) ou <uuid>/part.1.
	files, derr := docker.ReadTree(ctx, minioBox, "/data/"+b+"/"+k, 1<<20, 10)
	if derr != nil {
		res["disk"] = map[string]any{"error": derr.Error()}
		writeJSON(w, res, nil)
		return
	}
	name, raw := "", []byte(nil)
	for n, c := range files {
		if strings.HasSuffix(n, "part.1") {
			name, raw = n, c
		}
	}
	if name == "" {
		for n, c := range files {
			if strings.HasSuffix(n, "xl.meta") {
				name, raw = n, c
			}
		}
	}
	prefix := "/data/" + b + "/"
	if d := path.Dir(k); d != "." {
		prefix += d + "/"
	}
	// Le contenu (tel que le voit S3) se retrouve-t-il tel quel dans les octets du disque ?
	probe := []byte(strings.TrimSpace(content))
	if len(probe) > 40 {
		probe = probe[:40]
	}
	readable := len(probe) >= 8 && bytes.Contains(raw, probe)
	res["disk"] = map[string]any{"file": prefix + name, "size": len(raw), "readable": readable,
		"entropy": entropy(raw), "dump": hexdump(raw, 0, min(len(raw), 320))}
	writeJSON(w, res, nil)
}
