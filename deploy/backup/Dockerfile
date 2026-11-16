FROM alpine:3.22
RUN apk add --no-cache postgresql17-client rclone curl
COPY backup.sh restore-check.sh loop.sh /
RUN chmod +x /backup.sh /restore-check.sh /loop.sh
ENTRYPOINT ["/loop.sh"]
