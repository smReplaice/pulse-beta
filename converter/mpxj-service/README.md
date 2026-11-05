# MPP Converter Service

Binary Microsoft Project (`.mpp`) is a closed format. The only maintained,
lawful parser is **mpxj** (Java). Pulse therefore converts `.mpp` → MSPDI
XML in this tiny Spring Boot service, and the Pulse API maps the MSPDI with
its own first-party parser (used directly for `.xml` imports).

## Deployment

```bash
cd converter/mpxj-service
docker build -t pulse-mpxj-converter .
docker run -p 8080:8080 pulse-mpxj-converter
```

Then point Pulse at it:

```env
# apps/api/.env
MSPROJECT_CONVERTER_URL=http://localhost:8080
MSPROJECT_CONVERTER_TIMEOUT_MS=60000
```

Without this variable, `.mpp` uploads fail with an actionable error asking
for MS Project XML instead; `.xml` imports work with no converter at all.

## API

`POST /convert` (multipart, field `file`) → `200` MSPDI XML ·
`422 {"error": "…"}` unreadable/encrypted/unsupported · `400` empty file.

## Operational limits

- Heap capped at 1 GB (`JAVA_OPTS`); recycle on OOM.
- The Pulse client aborts after `MSPROJECT_CONVERTER_TIMEOUT_MS` (60 s default).
- Upload size is bounded twice: multer (`MSPROJECT_MAX_UPLOAD_BYTES`, 26 MB)
  and Spring's multipart limit — tune both together.
- The service is stateless; run one replica per ~4 concurrent imports and
  put it behind the same private network as the API. Never expose it
  publicly: it accepts arbitrary binary files.

## Failure handling

| Failure | Behaviour in Pulse |
|---|---|
| Service down / URL unset | `503` “converter required/unreachable” with the XML-export alternative |
| Timeout | `503` with timeout message |
| Encrypted / newer-format .mpp | `422` mapped to “cannot read this MPP file” |
| Corrupted file | rejected earlier by the OLE2 signature check in the API |

## Licence note

mpxj is dual-licensed: **GPLv3** or a commercial licence from Packlink
(support@mpxj.org). Shipping this service inside a proprietary product
requires the commercial licence. The Pulse API itself contains no mpxj code.
