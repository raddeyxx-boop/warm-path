  # n8n Integration

Start the local integration server:

```powershell
npm run n8n
```

Default URL:

```text
http://127.0.0.1:5679
```

## n8n HTTP Request Node

Use an **HTTP Request** node with:

```text
Method: POST
URL: http://127.0.0.1:5679/rank-mutuals
Send Body: JSON
```

Example body:

```json
{
  "urls": [
    "https://www.linkedin.com/in/rahul-bothra-0231608",
    "https://www.linkedin.com/in/gokul-rajan-5b146a18a"
  ]
}
```

For a quick test run:

```json
{
  "urls": [
    "https://www.linkedin.com/in/rahul-bothra-0231608"
  ],
  "profileLimit": 1
}
```

The response contains:

```json
{
  "ok": true,
  "count": 1,
  "results": [
    {
      "name": "Rahul Bothra",
      "company": "Swiggy Institute of Chartered Accountants of India",
      "location": "Bengaluru, Karnataka, India",
      "score": 5,
      "url": "https://www.linkedin.com/in/rahul-bothra-0231608"
    }
  ]
}
```

## Optional Callback

If you want the local server to send results back to an n8n Webhook node, start it with:

```powershell
$env:N8N_CALLBACK_URL="https://your-n8n-host/webhook/warm-path-results"
npm run n8n
```

## Health Check

```text
GET http://127.0.0.1:5679/health
```

## Notes

- The server writes incoming URLs to `data/mutuals.json`.
- It runs `scripts/rank-mutuals.js`.
- It returns parsed rows from `data/ranked-mutuals.csv`.
- Only one ranking run is allowed at a time because the scripts use shared files.
- LinkedIn scraping opens Chromium through the existing Playwright setup and saved session.
