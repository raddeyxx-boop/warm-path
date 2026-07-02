# n8n Integration

The Playwright side of this project is a data collection pipeline. n8n should pass
the current target into `index.js`, then consume the generated JSON files.

## Webhook Payload

Send the target dynamically from your webhook or previous n8n node:

```json
{
  "target": "Target Name",
  "url": "https://www.linkedin.com/in/target-profile/",
  "company": "Company Name"
}
```

Only `target` is required. `url` and `company` may be empty strings.

## Execute Command Node

Use an **Execute Command** node after your target extraction node.

```powershell
node index.js "{{$json.target}}" "{{$json.url || ''}}" "{{$json.company || ''}}"
```

If your extraction node returns `name` instead of `target`, use:

```powershell
node index.js "{{$json.name}}" "{{$json.url || ''}}" "{{$json.company || ''}}"
```

Do not type a real person name directly into the command. The value should come
from the current n8n item.

## Generated Files

After a successful run, n8n can read:

```text
data/target.json
data/mutuals.json
data/mutual-details.json
```

## Local Integration Server

The optional local server can still be started with:

```powershell
npm run n8n
```

Default URL:

```text
http://127.0.0.1:5679
```

Health check:

```text
GET http://127.0.0.1:5679/health
```
