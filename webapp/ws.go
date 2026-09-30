package main

// WebSocket minimal (RFC 6455), bibliothèque standard uniquement : assez pour
// relier xterm.js (navigateur) à un shell interactif dans la toolbox.

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
)

const (
	opCont   = 0
	opText   = 1
	opBinary = 2
	opClose  = 8
	opPing   = 9
	opPong   = 10
	maxFrame = 1 << 20
)

type WSConn struct {
	c   net.Conn
	br  *bufio.Reader
	wmu sync.Mutex
}

func wsUpgrade(w http.ResponseWriter, r *http.Request) (*WSConn, error) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || r.Header.Get("Sec-WebSocket-Key") == "" {
		http.Error(w, "WebSocket attendu", http.StatusBadRequest)
		return nil, errors.New("pas une requête WebSocket")
	}
	// même origine uniquement (pas de pilotage du terminal depuis un autre site)
	if o := r.Header.Get("Origin"); o != "" && !strings.HasSuffix(o, "://"+r.Host) {
		http.Error(w, "origine refusée", http.StatusForbidden)
		return nil, errors.New("origine refusée : " + o)
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("hijack impossible")
	}
	c, brw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}
	h := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	brw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
		base64.StdEncoding.EncodeToString(h[:]) + "\r\n\r\n")
	if err := brw.Flush(); err != nil {
		c.Close()
		return nil, err
	}
	return &WSConn{c: c, br: brw.Reader}, nil
}

// Read renvoie le prochain message complet (texte ou binaire) ; répond aux ping.
func (ws *WSConn) Read() (op byte, msg []byte, err error) {
	for {
		var hdr [2]byte
		if _, err = io.ReadFull(ws.br, hdr[:]); err != nil {
			return
		}
		fin, code := hdr[0]&0x80 != 0, hdr[0]&0x0f
		masked, n := hdr[1]&0x80 != 0, uint64(hdr[1]&0x7f)
		switch n {
		case 126:
			var b [2]byte
			if _, err = io.ReadFull(ws.br, b[:]); err != nil {
				return
			}
			n = uint64(binary.BigEndian.Uint16(b[:]))
		case 127:
			var b [8]byte
			if _, err = io.ReadFull(ws.br, b[:]); err != nil {
				return
			}
			n = binary.BigEndian.Uint64(b[:])
		}
		if n > maxFrame || len(msg)+int(n) > maxFrame {
			return 0, nil, errors.New("message trop grand")
		}
		var key [4]byte
		if masked {
			if _, err = io.ReadFull(ws.br, key[:]); err != nil {
				return
			}
		}
		p := make([]byte, n)
		if _, err = io.ReadFull(ws.br, p); err != nil {
			return
		}
		if masked {
			for i := range p {
				p[i] ^= key[i%4]
			}
		}
		switch code {
		case opPing:
			ws.write(opPong, p)
			continue
		case opPong:
			continue
		case opClose:
			ws.write(opClose, nil)
			return opClose, nil, io.EOF
		case opText, opBinary:
			op = code
		}
		msg = append(msg, p...)
		if fin {
			return op, msg, nil
		}
	}
}

func (ws *WSConn) write(op byte, p []byte) error {
	ws.wmu.Lock()
	defer ws.wmu.Unlock()
	hdr := []byte{0x80 | op}
	switch n := len(p); {
	case n < 126:
		hdr = append(hdr, byte(n))
	case n < 1<<16:
		hdr = append(hdr, 126, byte(n>>8), byte(n))
	default:
		hdr = append(hdr, 127)
		hdr = binary.BigEndian.AppendUint64(hdr, uint64(n))
	}
	if _, err := ws.c.Write(append(hdr, p...)); err != nil {
		return err
	}
	return nil
}

func (ws *WSConn) Binary(p []byte) error { return ws.write(opBinary, p) }
func (ws *WSConn) Text(p []byte) error   { return ws.write(opText, p) }
func (ws *WSConn) Close() error          { ws.write(opClose, nil); return ws.c.Close() }
