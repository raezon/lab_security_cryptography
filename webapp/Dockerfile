# Console web DataCorp Secure (Go, bibliothèque standard uniquement)
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
COPY static ./static
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /labconsole .

FROM alpine:3.20
COPY --from=build /labconsole /usr/local/bin/labconsole
EXPOSE 8085
ENTRYPOINT ["/usr/local/bin/labconsole"]
