FROM golang:1.26.4-alpine AS build

WORKDIR /src
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=$GOPROXY

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server ./cmd/server \
    && CGO_ENABLED=0 GOOS=linux go build -o /out/worker ./cmd/worker \
    && CGO_ENABLED=0 GOOS=linux go build -o /out/crawler ./cmd/crawler \
    && CGO_ENABLED=0 GOOS=linux go build -o /out/migrate ./cmd/migrate

FROM gcr.io/distroless/static-debian12:nonroot AS runtime-base

WORKDIR /app
COPY --from=build /out/ /app/
COPY migrations/ /app/migrations/

EXPOSE 8080
USER nonroot:nonroot

FROM runtime-base AS runtime-server
ENTRYPOINT ["/app/server"]

FROM runtime-base AS runtime-worker
ENTRYPOINT ["/app/worker"]

FROM runtime-base AS runtime-crawler
ENTRYPOINT ["/app/crawler"]

FROM runtime-server AS runtime
