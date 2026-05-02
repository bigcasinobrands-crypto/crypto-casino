# Build: docker build -t casino-api -f services/core/Dockerfile services/core
FROM golang:1.23-alpine AS build
RUN apk add --no-cache git ca-certificates
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

# base-debian12 includes CA certs — needed for TLS to Supabase Postgres and rediss:// Redis (static image alone can break HTTPS/TLS).
FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /app
COPY --from=build /out/api /app/api
COPY --from=build /out/migrate /app/migrate
USER nonroot:nonroot
EXPOSE 9090
ENTRYPOINT ["/app/api"]
