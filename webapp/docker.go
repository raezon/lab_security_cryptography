package main

// Client minimal de l'API Docker Engine (socket unix), sans dépendance :
//   - exec d'une commande dans un conteneur, sortie en flux ;
//   - lecture d'un fichier sur le disque d'un conteneur (GET /archive -> tar) ;
//   - liste des conteneurs du projet compose.

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Docker struct {
	hc   *http.Client
	sock string
}

func NewDocker(sock string) *Docker {
	tr := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, "unix", sock)
	}}
	return &Docker{hc: &http.Client{Transport: tr}, sock: sock}
}

func (d *Docker) do(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://docker/v1.41"+path, rd)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := d.hc.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		defer resp.Body.Close()
		msg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("docker %s %s: %d %s", method, path, resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	return resp, nil
}

// Exec lance cmd dans le conteneur et écrit stdout+stderr dans out au fil de l'eau.
// Renvoie le code de sortie.
func (d *Docker) Exec(ctx context.Context, container, user string, env, cmd []string, out io.Writer) (int, error) {
	wd := "" // répertoire par défaut de l'image ; /lab n'existe que dans la toolbox
	if container == toolbox {
		wd = "/lab"
	}
	resp, err := d.do(ctx, "POST", "/containers/"+container+"/exec", map[string]any{
		"AttachStdout": true, "AttachStderr": true, "Tty": false,
		"Cmd": cmd, "Env": env, "User": user, "WorkingDir": wd,
	})
	if err != nil {
		return -1, err
	}
	var created struct{ Id string }
	json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()

	resp, err = d.do(ctx, "POST", "/exec/"+created.Id+"/start", map[string]any{"Detach": false, "Tty": false})
	if err != nil {
		return -1, err
	}
	err = demux(resp.Body, out)
	resp.Body.Close()
	if err != nil && !errors.Is(err, io.EOF) {
		return -1, err
	}

	// code de sortie (quelques ms peuvent s'écouler après la fin du flux)
	for i := 0; i < 20; i++ {
		r, err := d.do(ctx, "GET", "/exec/"+created.Id+"/json", nil)
		if err != nil {
			return -1, err
		}
		var st struct {
			Running  bool
			ExitCode int
		}
		json.NewDecoder(r.Body).Decode(&st)
		r.Body.Close()
		if !st.Running {
			return st.ExitCode, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return -1, errors.New("exec toujours en cours")
}

// ExecOutput : Exec qui renvoie la sortie complète.
func (d *Docker) ExecOutput(ctx context.Context, container string, env []string, script string) (string, int, error) {
	var buf bytes.Buffer
	code, err := d.Exec(ctx, container, "", env, []string{"bash", "-c", script}, &buf)
	return buf.String(), code, err
}

// demux décode le flux multiplexé de Docker (en-tête 8 octets : flux, 0,0,0, taille big-endian).
func demux(r io.Reader, out io.Writer) error {
	hdr := make([]byte, 8)
	for {
		if _, err := io.ReadFull(r, hdr); err != nil {
			return err
		}
		n := binary.BigEndian.Uint32(hdr[4:])
		if _, err := io.CopyN(out, r, int64(n)); err != nil {
			return err
		}
		if f, ok := out.(http.Flusher); ok {
			f.Flush()
		}
	}
}

// ReadFile lit un fichier directement sur le disque d'un conteneur (API archive).
func (d *Docker) ReadFile(ctx context.Context, container, path string, max int64) ([]byte, error) {
	files, err := d.ReadTree(ctx, container, path, max, 1)
	if err != nil {
		return nil, err
	}
	for _, b := range files {
		return b, nil
	}
	return nil, fmt.Errorf("%s : fichier introuvable", path)
}

// ReadTree lit jusqu'à limit fichiers réguliers sous path (fichier ou répertoire).
func (d *Docker) ReadTree(ctx context.Context, container, path string, max int64, limit int) (map[string][]byte, error) {
	resp, err := d.do(ctx, "GET", "/containers/"+container+"/archive?path="+url.QueryEscape(path), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	tr := tar.NewReader(resp.Body)
	files := map[string][]byte{}
	for len(files) < limit {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return files, err
		}
		if h.Typeflag != tar.TypeReg {
			continue
		}
		b, _ := io.ReadAll(io.LimitReader(tr, max))
		files[h.Name] = b
	}
	return files, nil
}

type ContainerInfo struct {
	Name    string `json:"name"`
	Service string `json:"service"`
	State   string `json:"state"`
	Status  string `json:"status"`
	Image   string `json:"image"`
}

func (d *Docker) ListProject(ctx context.Context, project string) ([]ContainerInfo, error) {
	f := url.QueryEscape(fmt.Sprintf(`{"label":["com.docker.compose.project=%s"]}`, project))
	resp, err := d.do(ctx, "GET", "/containers/json?all=1&filters="+f, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var raw []struct {
		Names  []string
		Image  string
		State  string
		Status string
		Labels map[string]string
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}
	out := make([]ContainerInfo, 0, len(raw))
	for _, c := range raw {
		out = append(out, ContainerInfo{
			Name: strings.TrimPrefix(c.Names[0], "/"), Service: c.Labels["com.docker.compose.service"],
			State: c.State, Status: c.Status, Image: c.Image,
		})
	}
	return out, nil
}
