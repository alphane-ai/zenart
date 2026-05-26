FROM golang:1.22-bookworm AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server ./cmd/server \
    && CGO_ENABLED=0 GOOS=linux go build -o /out/worker ./cmd/worker \
    && CGO_ENABLED=0 GOOS=linux go build -o /out/crawler ./cmd/crawler \
    && CGO_ENABLED=0 GOOS=linux go build -o /out/migrate ./cmd/migrate

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY --from=build /out/ /app/
COPY migrations/ /app/migrations/

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/server"]
