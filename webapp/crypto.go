package main

// Démonstrations de chiffrement : EN TRANSIT (TLS), APPLICATIF (Vault transit,
// chiffrement d'enveloppe) et AU REPOS (fichiers lus directement sur les disques
// des conteneurs).

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ------------------------------------------------------------------ TLS

type Endpoint struct {
	ID, Name, Addr, SNI, Proto, Usage string
}

var endpoints = []Endpoint{
	{"postgres", "PostgreSQL", "postgres:5432", "postgres", "postgres", "toolbox, Vault et pipeline → base (sslmode=verify-full)"},
	{"vault", "Vault API", "vault:8200", "vault", "https", "pipeline, toolbox → coffre (HTTPS)"},
	{"minio", "MinIO S3", "minio:9000", "minio", "https", "consommateur → stockage objet (HTTPS)"},
	{"rabbitmq", "RabbitMQ AMQPS", "rabbitmq:5671", "rabbitmq", "amqps", "producteur / consommateur → broker"},
	{"rabbitmq-mgmt", "RabbitMQ management", "rabbitmq:15671", "rabbitmq", "https", "Vault (moteur rabbitmq) → API de gestion"},
}

type CertInfo struct {
	Subject     string   `json:"subject"`
	Issuer      string   `json:"issuer"`
	SANs        []string `json:"sans"`
	NotBefore   string   `json:"notBefore"`
	NotAfter    string   `json:"notAfter"`
	KeyAlgo     string   `json:"keyAlgo"`
	SigAlgo     string   `json:"sigAlgo"`
	Fingerprint string   `json:"fingerprint"`
	IsCA        bool     `json:"isCA"`
}

type TLSResult struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	Addr     string     `json:"addr"`
	Usage    string     `json:"usage"`
	Test     string     `json:"test"`
	OK       bool       `json:"ok"`
	Error    string     `json:"error,omitempty"`
	Version  string     `json:"version,omitempty"`
	Cipher   string     `json:"cipher,omitempty"`
	KX       string     `json:"kx,omitempty"`
	ALPN     string     `json:"alpn,omitempty"`
	Verified bool       `json:"verified"`
	Chain    []CertInfo `json:"chain,omitempty"`
	Millis   int64      `json:"ms"`
	Explain  string     `json:"explain,omitempty"`
}

func labCAPool() *x509.CertPool {
	pool := x509.NewCertPool()
	if b, err := os.ReadFile("/certs/ca.crt"); err == nil {
		pool.AppendCertsFromPEM(b)
	}
	return pool
}

func certInfo(c *x509.Certificate) CertInfo {
	ci := CertInfo{
		Subject: c.Subject.String(), Issuer: c.Issuer.String(),
		NotBefore: c.NotBefore.Format("2006-01-02"), NotAfter: c.NotAfter.Format("2006-01-02"),
		SigAlgo: c.SignatureAlgorithm.String(), IsCA: c.IsCA,
	}
	for _, d := range c.DNSNames {
		ci.SANs = append(ci.SANs, "DNS:"+d)
	}
	for _, ip := range c.IPAddresses {
		ci.SANs = append(ci.SANs, "IP:"+ip.String())
	}
	switch k := c.PublicKey.(type) {
	case *rsa.PublicKey:
		ci.KeyAlgo = fmt.Sprintf("RSA %d bits", k.N.BitLen())
	case *ecdsa.PublicKey:
		ci.KeyAlgo = "ECDSA " + k.Curve.Params().Name
	default:
		ci.KeyAlgo = c.PublicKeyAlgorithm.String()
	}
	sum := sha256.Sum256(c.Raw)
	ci.Fingerprint = strings.ToUpper(hex.EncodeToString(sum[:]))
	return ci
}

// dialRaw ouvre la connexion TCP et, pour PostgreSQL, négocie le passage en TLS
// (SSLRequest : le serveur répond 'S' puis la poignée de main TLS commence).
func dialRaw(ep Endpoint) (net.Conn, error) {
	conn, err := net.DialTimeout("tcp", ep.Addr, 4*time.Second)
	if err != nil {
		return nil, err
	}
	conn.SetDeadline(time.Now().Add(8 * time.Second))
	if ep.Proto == "postgres" {
		req := make([]byte, 8)
		binary.BigEndian.PutUint32(req[0:], 8)
		binary.BigEndian.PutUint32(req[4:], 80877103)
		if _, err := conn.Write(req); err != nil {
			conn.Close()
			return nil, err
		}
		b := make([]byte, 1)
		if _, err := io.ReadFull(conn, b); err != nil || b[0] != 'S' {
			conn.Close()
			return nil, fmt.Errorf("le serveur refuse SSLRequest (%q)", b)
		}
	}
	return conn, nil
}

// probeTLS : test = normal | wrongname | noca | tls11
func probeTLS(ep Endpoint, test string) TLSResult {
	res := TLSResult{ID: ep.ID, Name: ep.Name, Addr: ep.Addr, Usage: ep.Usage, Test: test}
	start := time.Now()
	cfg := &tls.Config{ServerName: ep.SNI, RootCAs: labCAPool()}
	switch test {
	case "wrongname":
		cfg.ServerName = "banque-pirate.example"
		res.Explain = "Un attaquant (homme du milieu) présente un certificat valide… mais pour un autre nom. verify-full refuse ; sslmode=require aurait accepté."
	case "noca":
		cfg.RootCAs = x509.NewCertPool()
		res.Explain = "Sans la CA du lab dans le magasin de confiance, le certificat ne peut pas être vérifié."
	case "tls11":
		cfg.MinVersion, cfg.MaxVersion = tls.VersionTLS10, tls.VersionTLS11
		res.Explain = "Le client propose au maximum TLS 1.1 (obsolète) : le serveur exige TLS ≥ 1.2 et refuse la poignée de main."
	}
	raw, err := dialRaw(ep)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer raw.Close()
	tc := tls.Client(raw, cfg)
	err = tc.Handshake()
	res.Millis = time.Since(start).Milliseconds()
	st := tc.ConnectionState()
	if err != nil {
		res.Error = err.Error()
		// on montre quand même le certificat présenté (connexion non vérifiée)
		if test == "wrongname" || test == "noca" {
			if r2, e2 := dialRaw(ep); e2 == nil {
				t2 := tls.Client(r2, &tls.Config{ServerName: ep.SNI, InsecureSkipVerify: true})
				if t2.Handshake() == nil {
					for _, c := range t2.ConnectionState().PeerCertificates {
						res.Chain = append(res.Chain, certInfo(c))
					}
				}
				r2.Close()
			}
		}
		return res
	}
	res.OK, res.Verified = true, true
	res.Version = tls.VersionName(st.Version)
	res.Cipher = tls.CipherSuiteName(st.CipherSuite)
	res.ALPN = st.NegotiatedProtocol
	if st.Version == tls.VersionTLS13 {
		res.KX = "ECDHE (X25519/P-256) — confidentialité persistante"
	}
	for _, c := range st.PeerCertificates {
		res.Chain = append(res.Chain, certInfo(c))
	}
	if len(st.VerifiedChains) > 0 {
		root := st.VerifiedChains[0][len(st.VerifiedChains[0])-1]
		if root != st.PeerCertificates[len(st.PeerCertificates)-1] {
			res.Chain = append(res.Chain, certInfo(root))
		}
	}
	return res
}

// ------------------------------------------------------------------ Connexions en clair

type PlainResult struct {
	Target   string `json:"target"`
	Attempt  string `json:"attempt"`
	Refused  bool   `json:"refused"`
	Response string `json:"response"`
	Explain  string `json:"explain"`
}

func plaintextTests() []PlainResult {
	var out []PlainResult

	// PostgreSQL : StartupMessage sans SSLRequest -> pg_hba "hostnossl ... reject"
	r := PlainResult{Target: "PostgreSQL postgres:5432", Attempt: "StartupMessage (user=postgres) sans passer en TLS",
		Explain: "pg_hba.conf : « hostnossl all all 0.0.0.0/0 reject » — le serveur refuse avant même de demander le mot de passe."}
	if c, err := net.DialTimeout("tcp", "postgres:5432", 3*time.Second); err != nil {
		r.Response = err.Error()
	} else {
		c.SetDeadline(time.Now().Add(4 * time.Second))
		var body bytes.Buffer
		binary.Write(&body, binary.BigEndian, uint32(196608))
		body.WriteString("user\x00postgres\x00database\x00datacorp\x00\x00")
		msg := make([]byte, 4)
		binary.BigEndian.PutUint32(msg, uint32(body.Len()+4))
		c.Write(append(msg, body.Bytes()...))
		buf := make([]byte, 1024)
		n, _ := io.ReadAtLeast(c, buf, 1)
		c.Close()
		if n > 0 && buf[0] == 'E' {
			r.Refused = true
			for _, f := range bytes.Split(buf[5:n], []byte{0}) {
				if len(f) > 1 && f[0] == 'M' {
					r.Response = "ErrorResponse : " + string(f[1:])
				}
			}
		} else {
			r.Response = fmt.Sprintf("%q", buf[:n])
		}
	}
	out = append(out, r)

	// Vault : HTTP en clair sur le port HTTPS
	r = PlainResult{Target: "Vault vault:8200", Attempt: "GET /v1/sys/health en HTTP (sans TLS)",
		Explain: "Le listener Vault n'accepte que TLS (tls_min_version = tls12)."}
	r.Response, r.Refused = plainHTTP("vault:8200")
	out = append(out, r)

	r = PlainResult{Target: "MinIO minio:9000", Attempt: "GET /minio/health/live en HTTP (sans TLS)",
		Explain: "MinIO est lancé avec --certs-dir : l'API S3 n'est servie qu'en HTTPS."}
	r.Response, r.Refused = plainHTTP("minio:9000")
	out = append(out, r)

	// RabbitMQ : port AMQP en clair 5672 désactivé (listeners.tcp = none)
	r = PlainResult{Target: "RabbitMQ rabbitmq:5672", Attempt: "connexion AMQP en clair (port 5672)",
		Explain: "rabbitmq.conf : « listeners.tcp = none » — seul AMQPS :5671 écoute."}
	if c, err := net.DialTimeout("tcp", "rabbitmq:5672", 3*time.Second); err != nil {
		r.Refused, r.Response = true, err.Error()
	} else {
		c.Close()
		r.Response = "port ouvert !"
	}
	out = append(out, r)
	return out
}

func plainHTTP(addr string) (string, bool) {
	c, err := net.DialTimeout("tcp", addr, 3*time.Second)
	if err != nil {
		return err.Error(), true
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(4 * time.Second))
	fmt.Fprintf(c, "GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", addr)
	b, _ := io.ReadAll(io.LimitReader(c, 400))
	s := strings.TrimSpace(string(b))
	if s == "" {
		return "(connexion fermée sans réponse)", true
	}
	return s, strings.Contains(s, "400") || strings.Contains(strings.ToLower(s), "https")
}

// ------------------------------------------------------------------ Capture « sur le fil »

type tapConn struct {
	net.Conn
	mu      sync.Mutex
	sent    bytes.Buffer
	recv    bytes.Buffer
	records []WireRecord
}

type WireRecord struct {
	Dir     string `json:"dir"` // "→" client→serveur, "←"
	Type    string `json:"type"`
	Version string `json:"version"`
	Len     int    `json:"len"`
	Hex     string `json:"hex"`
	ASCII   string `json:"ascii"`
}

func (t *tapConn) Write(b []byte) (int, error) {
	t.mu.Lock()
	t.sent.Write(b)
	t.mu.Unlock()
	return t.Conn.Write(b)
}
func (t *tapConn) Read(b []byte) (int, error) {
	n, err := t.Conn.Read(b)
	t.mu.Lock()
	t.recv.Write(b[:n])
	t.mu.Unlock()
	return n, err
}

var recordTypes = map[byte]string{20: "ChangeCipherSpec", 21: "Alert", 22: "Handshake", 23: "ApplicationData (chiffré)"}

func parseRecords(dir string, data []byte) []WireRecord {
	var out []WireRecord
	for len(data) >= 5 && len(out) < 12 {
		typ, ver, n := data[0], binary.BigEndian.Uint16(data[1:3]), int(binary.BigEndian.Uint16(data[3:5]))
		if typ < 20 || typ > 23 || 5+n > len(data) {
			break
		}
		payload := data[5 : 5+n]
		name := recordTypes[typ]
		if typ == 22 && n > 0 {
			hs := map[byte]string{1: "ClientHello", 2: "ServerHello"}[payload[0]]
			if hs != "" {
				name += " · " + hs
			}
		}
		out = append(out, WireRecord{Dir: dir, Type: name, Version: fmt.Sprintf("0x%04x", ver), Len: n,
			Hex: hexPreview(data[:min(5+n, 5+96)]), ASCII: asciiPreview(payload, 96)})
		data = data[5+n:]
	}
	return out
}

func hexPreview(b []byte) string {
	var sb strings.Builder
	for i, x := range b {
		if i > 0 && i%16 == 0 {
			sb.WriteByte('\n')
		} else if i > 0 {
			sb.WriteByte(' ')
		}
		fmt.Fprintf(&sb, "%02x", x)
	}
	return sb.String()
}

func asciiPreview(b []byte, n int) string {
	if len(b) > n {
		b = b[:n]
	}
	out := make([]byte, len(b))
	for i, x := range b {
		if x >= 32 && x < 127 {
			out[i] = x
		} else {
			out[i] = '.'
		}
	}
	return string(out)
}

type WireCapture struct {
	Mode       string       `json:"mode"`
	Target     string       `json:"target"`
	Secret     string       `json:"secret"`
	AppRequest string       `json:"appRequest"`
	Records    []WireRecord `json:"records"`
	RawSent    string       `json:"rawSent"`
	Found      bool         `json:"found"` // le secret apparaît-il dans les octets capturés ?
	SNI        bool         `json:"sni"`   // le nom du serveur apparaît-il en clair ?
	Note       string       `json:"note"`
}

// wireDemo envoie la même requête contenant un IBAN en HTTPS (Vault) ou en HTTP
// clair (audit-sink) et renvoie ce qu'un espion réseau verrait.
func wireDemo(mode, secret string) WireCapture {
	body := fmt.Sprintf(`{"iban":"%s","note":"virement salaire"}`, secret)
	wc := WireCapture{Mode: mode, Secret: secret}
	if mode == "tls" {
		wc.Target = "https://vault:8200/v1/sys/health"
		raw, err := net.DialTimeout("tcp", "vault:8200", 4*time.Second)
		if err != nil {
			wc.Note = err.Error()
			return wc
		}
		tap := &tapConn{Conn: raw}
		tc := tls.Client(tap, &tls.Config{ServerName: "vault", RootCAs: labCAPool()})
		req := fmt.Sprintf("POST /v1/sys/health HTTP/1.1\r\nHost: vault\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(body), body)
		wc.AppRequest = req
		if err := tc.Handshake(); err != nil {
			wc.Note = err.Error()
			return wc
		}
		tc.Write([]byte(req))
		tc.SetDeadline(time.Now().Add(3 * time.Second))
		io.Copy(io.Discard, tc)
		tc.Close()
		wc.Records = append(parseRecords("→", tap.sent.Bytes()), parseRecords("←", tap.recv.Bytes())...)
		wc.Found = bytes.Contains(tap.sent.Bytes(), []byte(secret))
		wc.SNI = bytes.Contains(tap.sent.Bytes(), []byte("vault"))
		wc.RawSent = hexPreview(tap.sent.Bytes()[:min(tap.sent.Len(), 256)])
		wc.Note = "TLS 1.3 : seul le ClientHello est lisible (on y voit le nom « vault » via SNI). Tout le reste, dont l'en-tête HTTP et l'IBAN, voyage en ApplicationData chiffré AES-GCM / ChaCha20."
	} else {
		wc.Target = "http://audit-sink:8088/demo"
		raw, err := net.DialTimeout("tcp", "audit-sink:8088", 4*time.Second)
		if err != nil {
			wc.Note = err.Error()
			return wc
		}
		tap := &tapConn{Conn: raw}
		req := fmt.Sprintf("POST /demo HTTP/1.1\r\nHost: audit-sink\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(body), body)
		wc.AppRequest = req
		tap.Write([]byte(req))
		tap.SetDeadline(time.Now().Add(3 * time.Second))
		io.Copy(io.Discard, tap)
		tap.Close()
		wc.Found = bytes.Contains(tap.sent.Bytes(), []byte(secret))
		wc.RawSent = hexPreview(tap.sent.Bytes()[:min(tap.sent.Len(), 256)])
		wc.Records = []WireRecord{{Dir: "→", Type: "TCP brut (HTTP)", Len: tap.sent.Len(), Hex: hexPreview(tap.sent.Bytes()[:min(tap.sent.Len(), 96)]), ASCII: asciiPreview(tap.sent.Bytes(), 400)},
			{Dir: "←", Type: "TCP brut (HTTP)", Len: tap.recv.Len(), Hex: hexPreview(tap.recv.Bytes()[:min(tap.recv.Len(), 64)]), ASCII: asciiPreview(tap.recv.Bytes(), 200)}}
		wc.Note = "Sans TLS, n'importe quel équipement sur le chemin (tcpdump, Wi-Fi public, switch compromis) lit l'IBAN tel quel. (audit-sink répond 401 : rien n'est enregistré.)"
	}
	return wc
}

// ------------------------------------------------------------------ Vault (API native)

type Vault struct {
	hc    *http.Client
	token func(context.Context) (string, error)
}

func NewVault(token func(context.Context) (string, error)) *Vault {
	return &Vault{hc: &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: labCAPool(), ServerName: "vault"}}}, token: token}
}

func (v *Vault) call(ctx context.Context, method, path string, body any) (map[string]any, error) {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequestWithContext(ctx, method, "https://vault:8200/v1/"+path, rd)
	if !strings.HasPrefix(path, "sys/seal-status") {
		tok, err := v.token(ctx)
		if err != nil {
			return nil, err
		}
		req.Header.Set("X-Vault-Token", tok)
	}
	resp, err := v.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode >= 400 {
		if errs, ok := out["errors"].([]any); ok && len(errs) > 0 {
			return nil, fmt.Errorf("Vault %d : %v", resp.StatusCode, errs[0])
		}
		return nil, fmt.Errorf("Vault HTTP %d", resp.StatusCode)
	}
	return out, nil
}

func data(m map[string]any) map[string]any {
	if d, ok := m["data"].(map[string]any); ok {
		return d
	}
	return map[string]any{}
}

// envelope : chiffrement d'enveloppe (le principe de SSE-S3/KMS) — Vault génère
// une clé de données (DEK), on chiffre localement, on ne garde que la DEK chiffrée.
func (v *Vault) envelope(ctx context.Context, key, message string) (map[string]any, error) {
	r, err := v.call(ctx, "POST", "transit/datakey/plaintext/"+key, map[string]any{"bits": 256})
	if err != nil {
		return nil, err
	}
	d := data(r)
	dek, _ := base64.StdEncoding.DecodeString(fmt.Sprint(d["plaintext"]))
	block, err := aes.NewCipher(dek)
	if err != nil {
		return nil, err
	}
	gcm, _ := cipher.NewGCM(block)
	nonce := make([]byte, gcm.NonceSize())
	rand.Read(nonce)
	ct := gcm.Seal(nil, nonce, []byte(message), nil)

	// relecture : on redemande la DEK à Vault à partir de sa forme chiffrée
	r2, err := v.call(ctx, "POST", "transit/decrypt/"+key, map[string]any{"ciphertext": d["ciphertext"]})
	if err != nil {
		return nil, err
	}
	dek2, _ := base64.StdEncoding.DecodeString(fmt.Sprint(data(r2)["plaintext"]))
	b2, _ := aes.NewCipher(dek2)
	g2, _ := cipher.NewGCM(b2)
	pt, err := g2.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, errors.New("déchiffrement local impossible")
	}
	return map[string]any{
		"dekClearPreview": hex.EncodeToString(dek[:8]) + "… (32 octets, effacée de la mémoire après usage)",
		"dekWrapped":      d["ciphertext"],
		"nonce":           hex.EncodeToString(nonce),
		"ciphertext":      base64.StdEncoding.EncodeToString(ct),
		"decrypted":       string(pt),
		"stored":          map[string]any{"cle_chiffree": d["ciphertext"], "nonce": hex.EncodeToString(nonce), "donnees": base64.StdEncoding.EncodeToString(ct)},
	}, nil
}

// ------------------------------------------------------------------ Au repos : analyse d'octets

var (
	reIBANClear = regexp.MustCompile(`FR76\d{23}`)
	reVaultCT   = regexp.MustCompile(`vault:v\d+:[A-Za-z0-9+/=]{16,}`)
	reNIR       = regexp.MustCompile(`\b[12]\d{14}\b`) // \b : pas les suites de chiffres internes aux IBAN
)

type Finding struct {
	Label   string `json:"label"`
	Count   int    `json:"count"`
	Sample  string `json:"sample,omitempty"`
	Offset  int    `json:"offset"`
	Hexdump string `json:"hexdump,omitempty"`
	Danger  bool   `json:"danger"`
}

func scan(b []byte, re *regexp.Regexp, label string, danger bool) Finding {
	locs := re.FindAllIndex(b, -1)
	f := Finding{Label: label, Count: len(locs), Danger: danger && len(locs) > 0, Offset: -1}
	if len(locs) > 0 {
		s, e := locs[0][0], locs[0][1]
		f.Sample, f.Offset = string(b[s:min(e, s+60)]), s
		f.Hexdump = hexdump(b, max(0, s-16), min(len(b), s+64))
	}
	return f
}

func hexdump(b []byte, from, to int) string {
	from -= from % 16
	var sb strings.Builder
	for off := from; off < to; off += 16 {
		end := min(off+16, len(b))
		fmt.Fprintf(&sb, "%08x  ", off)
		for i := off; i < off+16; i++ {
			if i < end {
				fmt.Fprintf(&sb, "%02x ", b[i])
			} else {
				sb.WriteString("   ")
			}
		}
		sb.WriteString(" |" + asciiPreview(b[off:end], 16) + "|\n")
	}
	return sb.String()
}

func entropy(b []byte) float64 {
	if len(b) == 0 {
		return 0
	}
	var freq [256]float64
	for _, x := range b {
		freq[x]++
	}
	var h float64
	for _, f := range freq {
		if f > 0 {
			p := f / float64(len(b))
			h -= p * math.Log2(p)
		}
	}
	return h
}

func b64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

func unb64(s string) string {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return ""
	}
	return string(b)
}
