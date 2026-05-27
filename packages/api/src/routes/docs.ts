import express, { Router } from 'express';
import swaggerUiDist from 'swagger-ui-dist';

export function docsRouter(): Router {
  const router = Router();
  const swaggerUiPath = swaggerUiDist.getAbsoluteFSPath();

  router.get('/docs', (_req, res) => {
    res.send(swaggerHtml());
  });

  router.use('/docs', express.static(swaggerUiPath, { index: false }));

  return router;
}

function swaggerHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>did.acta.build — API Docs</title>
  <link rel="stylesheet" href="/docs/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; }
    *, *::before, *::after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script src="/docs/swagger-ui-standalone-preset.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIStandalonePreset,
      ],
      plugins: [SwaggerUIBundle.plugins.DownloadUrl],
      layout: 'StandaloneLayout',
    });
  </script>
</body>
</html>`;
}
