# Deploying Triad to AWS

This guide walks through every reasonable way to run a Triad API on AWS,
from serverless Lambda through container platforms and EC2. It is
opinionated where opinion helps and honest about trade-offs where it
doesn't.

> **TL;DR:** Use **Lambda + API Gateway v2 (HTTP API)** for bursty or
> low-traffic APIs. Use **ECS Fargate** (or App Runner) for
> channel-enabled apps, steady-traffic workloads, or anything that needs
> long-lived connections. Use **EC2** if you already manage EC2 and know
> what you're doing.

---

## Table of contents

1. [Decision matrix](#1-decision-matrix)
2. [`@triadjs/lambda` quickstart](#2-triadlambda-quickstart)
3. [Lambda + API Gateway v2 (HTTP API)](#3-lambda--api-gateway-v2-http-api)
4. [Lambda + Function URL](#4-lambda--function-url)
5. [Lambda + ALB](#5-lambda--alb)
6. [ECS Fargate](#6-ecs-fargate)
7. [App Runner](#7-app-runner)
8. [Elastic Beanstalk](#8-elastic-beanstalk)
9. [EC2 (raw)](#9-ec2-raw)
10. [CI/CD patterns](#10-cicd-patterns)
11. [Cold-start tuning for Lambda](#11-cold-start-tuning-for-lambda)
12. [Observability on AWS](#12-observability-on-aws)
13. [Common pitfalls](#13-common-pitfalls)
14. [Cost math](#14-cost-math)

---

## 1. Decision matrix

| Target | Adapter | Cold start | Cost shape | Channels | Setup complexity |
|---|---|---|---|---|---|
| **Lambda + API Gateway HTTP API** | `@triadjs/lambda` | 200-500 ms | Per-request (free tier generous) | No | Low |
| **Lambda + Function URL** | `@triadjs/lambda` | 200-500 ms | Per-request | No | Lowest |
| **Lambda + ALB** | `@triadjs/lambda` | 200-500 ms | Per-request + ALB hourly (~$18/mo) | No | Medium |
| **Lambda@Edge / CloudFront Fns** | `@triadjs/lambda` | <50 ms (edge) | Per-request | No | Medium-High |
| **ECS Fargate** | `@triadjs/fastify` (channels!) or any | N/A — always on | Task-hourly (~$15-30/mo for a tiny task) | **Yes** (Fastify) | Medium-High |
| **App Runner** | Any HTTP adapter | ~2 s from cold scale-to-zero | Per-request + container hourly | Yes | Low |
| **Elastic Beanstalk** | Any HTTP adapter | N/A | EC2 hourly | Yes | Medium |
| **EC2 (raw)** | Any HTTP adapter | N/A | EC2 hourly | Yes | Low (if you know EC2) |

### How to choose

**Pick Lambda if:**
- Traffic is bursty or unpredictable
- The app is idle a meaningful fraction of the time
- You want minimal ops and no servers to patch
- You do *not* need WebSocket channels (Lambda can't do long-lived
  connections)
- Cold-start latency in the 200-500 ms range is acceptable on the long
  tail

**Pick Fargate if:**
- You need WebSocket channels → use `@triadjs/fastify`
- Traffic is steady and high enough that container-hourly beats
  per-request pricing (roughly >5M req/mo for most APIs)
- You need to talk to a VPC RDS database over a long-lived pool
- You want predictable p99 latency without worrying about cold starts

**Pick App Runner if:**
- You want Fargate ergonomics without learning ECS task definitions
- Your team is small and ops capacity is low
- Scale-to-zero is okay (first request after idle pays the cold start)

**Pick Beanstalk if:**
- Your team already uses Beanstalk for other services — the
  institutional knowledge is worth more than the slight cost and
  complexity overhead

**Pick EC2 if:**
- You already run EC2 fleets and have baked images, monitoring, and
  deploy tooling for them
- You need a feature no managed service offers (weird kernel modules,
  custom network devices, etc.)

If you're unsure: start with **Lambda + API Gateway HTTP API**. It is
the cheapest path to production for most Triad apps, and if you outgrow
it, porting to Fargate is a Dockerfile and a service definition away —
Triad's router code is the same either way.

---

## 2. `@triadjs/lambda` quickstart

### Install

```bash
npm install @triadjs/lambda @triadjs/core
```

`@triadjs/lambda` has zero runtime dependencies other than `@triadjs/core`
itself. The whole point is that your Lambda bundle stays small so cold
starts stay fast.

### Write your handler

```ts
// src/handler.ts
import { createLambdaHandler } from '@triadjs/lambda';
import router from './app.js';

export const handler = createLambdaHandler(router, {
  services: { /* repos, sagas, clients */ },
});
```

`router` is the same `createRouter()`/`endpoint()` code you'd use with
Express, Fastify, or Hono. Triad's router is adapter-agnostic; the
Lambda adapter is a thin wrapper that normalizes events, runs
validation, and emits a Lambda response envelope.

### Bundle it

Lambda expects a single ESM file (or a CommonJS file plus `node_modules/`,
which is slower to cold-start). We strongly recommend bundling:

```bash
# Using esbuild
npx esbuild src/handler.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile=dist/handler.js \
  --external:aws-sdk

cd dist && zip -q function.zip handler.js
```

Or with `tsup`:

```ts
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/handler.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  minify: true,
  // Tree-shake aggressively — you want the smallest bundle possible.
  treeshake: true,
});
```

### Deploy (AWS CLI)

```bash
aws lambda create-function \
  --function-name triad-api \
  --runtime nodejs20.x \
  --architectures arm64 \
  --handler handler.handler \
  --role arn:aws:iam::123456789012:role/lambda-basic-execution \
  --zip-file fileb://dist/function.zip \
  --timeout 30 \
  --memory-size 512
```

**Notes:**
- `--architectures arm64` — Graviton is ~20% cheaper and usually
  faster for Node.js workloads.
- `--handler handler.handler` — the ESM file is `handler.js`, the named
  export is `handler`.
- `--memory-size 512` — Lambda allocates CPU proportional to memory.
  512 MB is a good starting point for Node; bump to 1024 if the p99 is
  slow.

---

## 3. Lambda + API Gateway v2 (HTTP API)

The HTTP API (v2) is the cheapest and simplest Lambda front end: about
70% cheaper than REST API (v1), with a simpler event shape and
automatic CORS support. Prefer it over v1 unless you need a v1-only
feature (usage plans, API keys, request/response transformations).

### Event flow

```
Client → API Gateway HTTP API → Lambda → @triadjs/lambda → Your endpoint handler
```

### Create the API (console)

1. **API Gateway → Create API → HTTP API → Build**
2. Integrations → Add integration → Lambda → pick your function
3. Configure routes → `ANY /{proxy+}` → the integration you just added
4. Stages → `$default` with auto-deploy
5. Deploy → copy the invoke URL

The wildcard route `ANY /{proxy+}` forwards every request to your
Lambda; `@triadjs/lambda` handles all method and path matching internally.

### CORS

API Gateway handles CORS at the gateway level, not inside Triad.
Configure it on the API → CORS tab:

- **Access-Control-Allow-Origin**: `https://your-frontend.example.com`
- **Access-Control-Allow-Methods**: `GET,POST,PUT,PATCH,DELETE,OPTIONS`
- **Access-Control-Allow-Headers**: `content-type,authorization,x-trace-id`
- **Access-Control-Max-Age**: `300`

Do **not** also handle CORS inside Triad — double-CORS leads to
confusing "blocked by preflight" errors.

### Stages and base paths

If you deploy the API under a stage like `/prod`, incoming requests
will have paths like `/prod/pets/42`. Tell `@triadjs/lambda` to strip the
prefix before route matching:

```ts
export const handler = createLambdaHandler(router, {
  services: { /* ... */ },
  basePath: '/prod',
});
```

With HTTP API v2's `$default` stage (the default), no prefix is added
and `basePath` is unnecessary. This matters mostly for v1 REST APIs.

### Custom domain + ACM

1. Request an ACM certificate in the same region as the API
2. API Gateway → Custom domain names → Create
3. Map the domain to your API + stage
4. Create a Route 53 A-record alias pointing at the API Gateway domain
5. Wait 10-20 min for DNS + ACM validation

### AWS CLI end-to-end

```bash
# 1. Create the function (assumes the zip exists)
aws lambda create-function \
  --function-name triad-api \
  --runtime nodejs20.x \
  --architectures arm64 \
  --handler handler.handler \
  --role arn:aws:iam::123456789012:role/lambda-basic \
  --zip-file fileb://dist/function.zip \
  --timeout 30 --memory-size 512

# 2. Create the HTTP API
API_ID=$(aws apigatewayv2 create-api \
  --name triad-api \
  --protocol-type HTTP \
  --target arn:aws:lambda:us-east-1:123456789012:function:triad-api \
  --query 'ApiId' --output text)

# 3. Allow API Gateway to invoke the function
aws lambda add-permission \
  --function-name triad-api \
  --statement-id apigw-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:123456789012:${API_ID}/*/*"

echo "https://${API_ID}.execute-api.us-east-1.amazonaws.com"
```

### SAM template

```yaml
# template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Resources:
  TriadApi:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: dist/
      Handler: handler.handler
      Runtime: nodejs20.x
      Architectures: [arm64]
      MemorySize: 512
      Timeout: 30
      Events:
        Proxy:
          Type: HttpApi
          Properties:
            Path: /{proxy+}
            Method: ANY
```

Deploy: `sam build && sam deploy --guided`

### CDK snippet (TypeScript)

```ts
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Runtime, Architecture, Code, Function } from 'aws-cdk-lib/aws-lambda';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

export class TriadApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const fn = new Function(this, 'TriadApi', {
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handler.handler',
      code: Code.fromAsset('dist'),
      memorySize: 512,
      timeout: Duration.seconds(30),
    });

    const api = new HttpApi(this, 'HttpApi');
    api.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration('TriadIntegration', fn),
    });
  }
}
```

### Troubleshooting

**`502 Bad Gateway`** — The Lambda ran but returned something API
Gateway couldn't parse. Check CloudWatch logs; common cause is a
runtime error before `createLambdaHandler` could format a response.
Make sure your handler export is `export const handler =
createLambdaHandler(...)` not `export default`.

**`{"message": "Internal Server Error"}`** (no Triad envelope) — API
Gateway's default error, not yours. Usually means the Lambda threw
before returning. Check the function's CloudWatch logs.

**`{"message": "Missing Authentication Token"}`** — You hit a URL that
isn't mapped by any route. For HTTP API v2, make sure the integration
is attached to `ANY /{proxy+}`, not just `ANY /`.

**CORS preflight fails** — Don't configure CORS both in API Gateway and
inside your app. Pick one.

---

## 4. Lambda + Function URL

Function URLs are the simplest possible Lambda front end: one HTTPS URL
per function, no API Gateway, no ALB, no config.

### Create one

```bash
aws lambda create-function-url-config \
  --function-name triad-api \
  --auth-type NONE \
  --cors '{"AllowOrigins":["*"],"AllowMethods":["*"]}'
```

Returns something like
`https://abcdefghij.lambda-url.us-east-1.on.aws/`.

Function URLs emit the same event shape as API Gateway HTTP API v2, so
`@triadjs/lambda` supports them with zero extra config.

### When to use

- Prototyping and personal projects
- Internal tools that don't need a custom domain
- Anywhere you want to avoid the API Gateway bill on very low traffic

### Limitations

- No custom domains (you can CNAME through CloudFront, but that adds
  complexity that defeats the simplicity point)
- No usage plans, API keys, throttling beyond account-level Lambda
  concurrency
- No request/response transforms
- No caching
- `AWS_IAM` auth requires SigV4 signing on every request — painful for
  browsers

For anything beyond prototyping, API Gateway HTTP API is only marginally
more work and gets you custom domains + stages + throttling.

---

## 5. Lambda + ALB

Application Load Balancer can forward requests to a Lambda target, just
like it forwards to EC2 or Fargate. Use this when:

- Your function needs to live inside a VPC with private subnets
- You already have ALB infrastructure and want one less thing to manage
- You need ALB-only features: WAF integration, sticky sessions,
  path-based routing to multiple services (e.g. Lambda for `/api/*`,
  Fargate for `/ui/*`)

### Event shape differences

ALB events look like API Gateway v1 but have a few differences:

- `requestContext.elb` is present
- `multiValueHeaders` and `multiValueQueryStringParameters` are the
  canonical source when the ALB target group has multi-value headers
  enabled
- `path` is the full request path, no stage prefix

`@triadjs/lambda` handles all of this transparently — the same handler
factory accepts ALB events and responds with the correct v1-ish shape.

### Setup

1. Create a target group of type **Lambda**, not **IP** or **Instance**
2. Register the function as the target
3. Add a listener rule on your ALB that forwards matching requests to
   the target group
4. Grant ALB permission to invoke the function:

```bash
aws lambda add-permission \
  --function-name triad-api \
  --statement-id alb-invoke \
  --action lambda:InvokeFunction \
  --principal elasticloadbalancing.amazonaws.com \
  --source-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/triad/abcdef
```

5. Enable **multi-value headers** on the target group if you want
   cookies and repeat-key headers to round-trip correctly.

### ALB vs API Gateway trade-offs

| | API Gateway v2 | ALB |
|---|---|---|
| Cost at low traffic | ~$0 | ~$18/mo ALB fixed |
| Cost at high traffic | Scales per-request | ALB cheaper past ~1M req/mo |
| Custom domains | Yes (free) | Yes |
| WebSockets | Separate API Gateway WebSocket API | No (ALB doesn't speak WS to Lambda) |
| VPC-only | No | Yes |
| Cold-start visibility | Via X-Ray | Via X-Ray |

ALB is a good fit when you've already paid the ALB fixed cost for other
services. Don't add one just to front a single Lambda.

---

## 6. ECS Fargate

When you need **channels, steady traffic, or long-lived connections**,
deploy your Triad app as a Fargate task using `@triadjs/fastify` (the
only adapter that supports WebSocket channels in v1).

### Dockerfile

```dockerfile
# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
```

`dist/server.js` is your Fastify entry point:

```ts
// src/server.ts
import Fastify from 'fastify';
import { createTriadPlugin } from '@triadjs/fastify';
import router from './app.js';

const app = Fastify({ logger: true });
await app.register(createTriadPlugin, { router, services: { /* ... */ } });

// Health check for the ALB target group
app.get('/healthz', async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
await app.listen({ host: '0.0.0.0', port });
```

### ECR push

```bash
aws ecr create-repository --repository-name triad-api
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

docker build -t triad-api:latest .
docker tag triad-api:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/triad-api:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/triad-api:latest
```

### Task definition

```json
{
  "family": "triad-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "triad",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/triad-api:latest",
      "essential": true,
      "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
      "healthCheck": {
        "command": ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/healthz').then(r=>r.ok?process.exit(0):process.exit(1))\""],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 10
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/triad-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "triad"
        }
      }
    }
  ]
}
```

### Service + ALB

- Create an ALB + target group (type **IP** for Fargate)
- Create an ECS service pointing at the task definition, attached to
  the target group
- Set desired count ≥ 2 for redundancy across AZs
- Enable ECS Circuit Breaker so failed deployments roll back

### CDK snippet

```ts
import { Cluster, ContainerImage, FargateTaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { Vpc } from 'aws-cdk-lib/aws-ec2';

const vpc = new Vpc(this, 'Vpc', { maxAzs: 2 });
const cluster = new Cluster(this, 'Cluster', { vpc });

new ApplicationLoadBalancedFargateService(this, 'Service', {
  cluster,
  cpu: 256,
  memoryLimitMiB: 512,
  desiredCount: 2,
  taskImageOptions: {
    image: ContainerImage.fromAsset('.'),
    containerPort: 3000,
  },
  publicLoadBalancer: true,
});
```

This is the fastest way to get a Fargate-hosted Triad app with an ALB
in front. `ApplicationLoadBalancedFargateService` handles everything —
VPC, cluster, ALB, target group, service, task definition.

---

## 7. App Runner

App Runner is "Fargate without the config": you point it at a
container image (or a GitHub repo), set env vars, and it hands you an
HTTPS URL. Perfect for small apps that want steady-traffic economics
without learning ECS task definitions.

### Dockerfile

Use the same Dockerfile from the Fargate section.

### apprunner.yaml (source-based builds)

```yaml
version: 1.0
runtime: nodejs20
build:
  commands:
    build:
      - npm ci
      - npm run build
run:
  runtime-version: 20
  command: node dist/server.js
  network:
    port: 3000
    env: PORT
  env:
    - name: NODE_ENV
      value: production
```

### Create the service

```bash
aws apprunner create-service \
  --service-name triad-api \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "123456789012.dkr.ecr.us-east-1.amazonaws.com/triad-api:latest",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": { "Port": "3000" }
    }
  }' \
  --instance-configuration '{
    "Cpu": "0.25 vCPU",
    "Memory": "0.5 GB"
  }'
```

### Observability caveat

App Runner's logging is less flexible than ECS — you get CloudWatch
Logs but finer-grained metrics (per-request latency histograms,
per-route counters) require you to emit them yourself via CloudWatch
EMF. For most small services this is fine.

App Runner scales to zero on low traffic, which means the first
request after idle pays a container cold start (~2 seconds for a
modest Node.js image). If p99 latency matters, disable scale-to-zero
by setting a minimum instance count ≥ 1.

---

## 8. Elastic Beanstalk

Beanstalk is the oldest managed runtime on AWS and still works. If your
team already uses it, Triad fits in with no ceremony. If you're
greenfield, use Fargate or App Runner instead — Beanstalk's abstraction
is leakier.

### Procfile

```
web: node dist/server.js
```

### Environment config

```yaml
# .ebextensions/01_nodecommand.config
option_settings:
  aws:elasticbeanstalk:container:nodejs:
    NodeCommand: "node dist/server.js"
  aws:elasticbeanstalk:application:environment:
    NODE_ENV: production
    PORT: 8080
```

### Deploy

```bash
eb init triad-api --platform "Node.js 20" --region us-east-1
eb create triad-api-prod
eb deploy
```

Beanstalk provisions EC2 instances behind an ALB, installs Node, runs
`npm install` and `npm start`, and gives you a URL. It handles rolling
deploys, health checks, and basic autoscaling.

---

## 9. EC2 (raw)

For teams that want full control. Here's the minimum viable setup:

### Systemd unit

```ini
# /etc/systemd/system/triad-api.service
[Unit]
Description=Triad API
After=network.target

[Service]
Type=simple
User=triad
WorkingDirectory=/opt/triad-api
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node /opt/triad-api/dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable triad-api
sudo systemctl start triad-api
```

### nginx reverse proxy

```nginx
# /etc/nginx/sites-available/triad-api
server {
  listen 80;
  server_name api.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket support — required if you use @triadjs/fastify channels
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
  }
}
```

### TLS via certbot

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com
```

Automated renewal runs from `/etc/cron.d/certbot`.

---

## 10. CI/CD patterns

### GitHub Actions → Lambda

```yaml
# .github/workflows/deploy-lambda.yml
name: Deploy Lambda
on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npm run build
      - run: cd dist && zip -qr ../function.zip .

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-deploy
          aws-region: us-east-1

      - run: |
          aws lambda update-function-code \
            --function-name triad-api \
            --zip-file fileb://function.zip \
            --publish
```

Uses OIDC to avoid long-lived AWS access keys in GitHub — the
`id-token: write` permission lets the action assume an IAM role via
federation.

### GitHub Actions → ECR → Fargate

```yaml
name: Deploy Fargate
on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-deploy
          aws-region: us-east-1

      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr

      - run: |
          docker build -t triad-api:${{ github.sha }} .
          docker tag triad-api:${{ github.sha }} \
            ${{ steps.ecr.outputs.registry }}/triad-api:${{ github.sha }}
          docker push \
            ${{ steps.ecr.outputs.registry }}/triad-api:${{ github.sha }}

      - run: |
          aws ecs update-service \
            --cluster triad-cluster \
            --service triad-api \
            --force-new-deployment
```

### Secrets via Secrets Manager

Don't ship secrets in environment variables set via the Lambda or ECS
console — they're visible in the task definition and leak through
CloudTrail. Use AWS Secrets Manager:

```ts
// src/services.ts
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});
const result = await client.send(
  new GetSecretValueCommand({ SecretId: 'triad/prod/db-url' }),
);
const dbUrl = result.SecretString!;
```

For Lambda, cache the result in module scope so subsequent invocations
reuse it. For Fargate, fetch at startup and keep it in memory.

---

## 11. Cold-start tuning for Lambda

A cold start = AWS spinning up a fresh execution environment. For
Node.js on Lambda, this is dominated by:

1. Downloading the zip (fast)
2. Starting the Node.js process (~100 ms)
3. `import`ing your bundle (depends heavily on bundle size)
4. Running top-level module code (anything outside the handler function)

### Measured numbers

For a small Triad app (10 endpoints, ~50 KB bundle including
`@triadjs/core` and `@triadjs/lambda`):
- **ARM64, 512 MB**: ~180-250 ms cold start
- **x86_64, 512 MB**: ~220-300 ms
- **ARM64, 1024 MB**: ~150-200 ms (more memory = more CPU, faster
  startup)

For a larger app (~100 endpoints, ~200 KB bundle):
- **ARM64, 512 MB**: ~320-450 ms

### Tuning levers, in order of impact

1. **Bundle to a single file.** Use `esbuild` or `tsup`. Tree-shake
   aggressively. Strip comments, minify. A 50 KB bundle beats a 500 KB
   bundle every time.
2. **Use ARM (Graviton).** ~20% cheaper and usually 10-20% faster for
   Node.js.
3. **Don't import heavyweight deps at the top level.** If you only use
   `@aws-sdk/client-s3` in one endpoint, `await import()` it inside the
   handler rather than at module load time. Lambda reuses the module
   graph between invocations in the same execution environment, so the
   dynamic import only pays the cost once per cold start.
4. **Bump memory to 1024 MB or higher** for latency-sensitive endpoints.
   CPU scales with memory; a larger allocation finishes the cold start
   faster and often costs the same or less because billed duration
   drops.
5. **Provisioned concurrency** for endpoints that cannot tolerate a
   cold start. Costs real money (~$10/mo per provisioned instance), so
   only use it for the critical path.
6. **Avoid top-level `await`** unless you really need it — top-level
   await blocks module loading until it resolves.

---

## 12. Observability on AWS

### Logs

Lambda and Fargate both ship logs to CloudWatch Logs by default. For
structured JSON logs that Logs Insights can query, use a logger that
emits JSON:

```ts
import pino from 'pino';
const log = pino({ formatters: { level: (label) => ({ level: label }) } });

log.info({ userId: '42', route: 'getPet' }, 'handled request');
```

Query in Logs Insights:

```
fields @timestamp, userId, route, @message
| filter level = "error"
| sort @timestamp desc
| limit 100
```

### Metrics

Lambda emits per-invocation metrics (Duration, Errors, Throttles,
ConcurrentExecutions) for free. Custom metrics cost extra — prefer
CloudWatch Embedded Metric Format (EMF) which piggybacks on your log
stream:

```ts
console.log(JSON.stringify({
  _aws: {
    Timestamp: Date.now(),
    CloudWatchMetrics: [{
      Namespace: 'Triad/Api',
      Dimensions: [['Route']],
      Metrics: [{ Name: 'LatencyMs', Unit: 'Milliseconds' }],
    }],
  },
  Route: 'getPet',
  LatencyMs: 42,
}));
```

CloudWatch picks this up, emits it as a metric, and you pay only for
the log bytes.

### Tracing with X-Ray

For end-to-end traces across Lambda, API Gateway, DynamoDB, and
downstream services:

1. Enable X-Ray on the Lambda function (console or
   `--tracing-config Mode=Active` on `create-function`)
2. Use the [`@triadjs/otel`](../../packages/otel/) package with the AWS
   X-Ray OTel exporter:

```ts
import { createTriadObservability } from '@triadjs/otel';
import { AWSXRayPropagator } from '@aws/otel-aws-xray-propagator';
// ... wire it up per the @triadjs/otel docs
```

3. Or use the AWS-managed OTel Lambda Layer
   (`arn:aws:lambda:REGION:901920570463:layer:aws-otel-nodejs-amd64-ver-1-x-x:x`)
   which auto-instruments without code changes.

See [the observability guide](./observability.md) for deeper coverage
of OTel with Triad.

---

## 13. Common pitfalls

**Lambda timeout mismatched with downstream services.** If your
downstream API takes 25 s to respond and your Lambda timeout is 30 s
but the API Gateway timeout is 29 s, you will see 504s where the
function is still running inside Lambda. Always: downstream timeout <
Lambda timeout < API Gateway timeout.

**API Gateway 29-second hard timeout.** You cannot raise this. If your
endpoint legitimately takes 30+ seconds, either break it into async
(SQS-backed) or run it on Fargate.

**Cold-start noise during low-traffic hours.** If your traffic drops
below ~1 req/minute, every new request will likely pay a cold start.
For human-facing APIs, consider provisioned concurrency ≥ 1 during
business hours.

**Missing IAM permissions for downstream services.** Lambda's
execution role needs explicit permission for every AWS API it calls.
`AWSLambdaBasicExecutionRole` only covers CloudWatch Logs. For
DynamoDB, S3, Secrets Manager, etc., attach the appropriate
least-privilege policies.

**Lambda response size limits.** Synchronous invocations are capped at
**6 MB** of response body. Async at 20 MB. If you need to return more,
upload to S3 and return a presigned URL.

**`NODE_ENV` not set by default.** Lambda doesn't set `NODE_ENV`, so
`process.env.NODE_ENV` is `undefined` unless you explicitly configure
it. Set it via the function's environment variables.

**Concurrent execution limits.** Your account has a concurrent
execution limit (default 1000). If your Lambda suddenly spikes to 2000
concurrent invocations, the overflow will throttle (429). Request a
limit increase before you need it.

**Region mismatches.** ACM certificates for API Gateway edge-optimized
endpoints must live in `us-east-1`. For regional endpoints, they live
in the same region as the API. Getting this wrong costs an afternoon.

---

## 14. Cost math

Honest napkin math for three workloads. Includes Lambda, API Gateway,
and CloudWatch Logs; excludes data transfer, NAT gateway, and whatever
downstream databases you talk to.

### 100k requests/month (indie app / side project)

- **Lambda (ARM, 512 MB, avg 100 ms)**: well within free tier, ~$0
- **API Gateway HTTP API**: 100k req × $1/M = **$0.10**
- **CloudWatch Logs**: ~$0.50
- **Total: ~$0.60/mo**

**Fargate** (0.25 vCPU, 0.5 GB, 1 task always on):
- **$15-18/mo** for the task alone, plus ALB (~$18) if you front it.

Lambda is the clear winner at this traffic level.

### 10M requests/month (small SaaS)

- **Lambda (ARM, 512 MB, avg 100 ms)**: 10M × 100ms × $0.0000133334/GB-s
  × 0.5 GB = **~$6.67**, plus request charges 10M × $0.20/M = **$2**,
  total **~$8.67**
- **API Gateway HTTP API**: 10M × $1/M = **$10**
- **CloudWatch Logs**: ~$5 (if you log modestly)
- **Total: ~$23.67/mo**

**Fargate** (0.5 vCPU, 1 GB, 2 tasks for HA):
- 2 × (~$18) = **$36** for tasks
- ALB: **~$18**
- **Total: ~$54/mo** for higher redundancy and lower p99

Roughly a wash depending on how much you value no-cold-start p99 vs.
operational simplicity.

### 100M requests/month (real production)

- **Lambda (ARM, 512 MB, avg 50 ms after optimization)**: 100M × 50ms ×
  0.5 GB × $0.0000133334/GB-s = **~$33**, plus 100M × $0.20/M = **$20**,
  total **~$53**
- **API Gateway HTTP API**: 100M × $1/M = **$100**
- **CloudWatch Logs**: **~$30-50**
- **Total: ~$180-200/mo**

**Fargate** (4 tasks, 1 vCPU, 2 GB each):
- 4 × ~$35 = **$140** for tasks
- ALB: **~$20** plus LCU charges (~$10-30)
- **Total: ~$170-190/mo**

At this scale the numbers are close, and the right answer depends on
the traffic shape. If 80% of the month is peak and 20% is dead, Lambda
wins. If traffic is roughly flat, Fargate is slightly cheaper and has
no cold starts.

For definitive numbers use the [AWS Pricing
Calculator](https://calculator.aws/) with your actual traffic shape.

---

## See also

- [Choosing an adapter](./choosing-an-adapter.md) — which Triad adapter
  to pick before you worry about where to deploy it
- [Observability](./observability.md) — OpenTelemetry, metrics, traces
- [`@triadjs/lambda` README](../../packages/lambda/README.md)
- [AWS Lambda developer
  guide](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)
- [API Gateway HTTP API developer
  guide](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html)
