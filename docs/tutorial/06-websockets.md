# Step 6 — WebSockets and real-time reviews

**Goal:** add a `bookReviews` channel so clients subscribed to a book receive a real-time broadcast whenever someone posts a review. Learn the `channel()` builder, the phantom witness pattern for typed connection state, channel behaviors, and the AsyncAPI output from `triad docs`.

Channels are to WebSockets what endpoints are to HTTP. The same schema DSL, the same behavior builder, the same mental model — declare once, get tests and docs and wire format for free. Channels are currently supported by the Fastify adapter only.

## 1. The `Review` model

Create `src/schemas/review.ts`:

```ts
import { t } from '@triad/core';

export const Review = t.model('Review', {
  id: t.string().format('uuid').identity().storage({ primaryKey: true }),
  bookId: t.string().format('uuid').storage({ columnName: 'book_id', indexed: true, references: 'books.id' }),
  authorId: t.string().format('uuid').storage({ columnName: 'author_id', references: 'users.id' }),
  authorName: t.string().minLength(1).maxLength(100).storage({ columnName: 'author_name' }),
  rating: t.int32().min(1).max(5),
  text: t.string().minLength(1).maxLength(2000),
  createdAt: t.datetime().storage({ defaultNow: true, columnName: 'created_at' }),
});

export const CreateReview = Review
  .pick('rating', 'text')
  .named('CreateReview');

export const ReviewSubmittedPayload = t.model('ReviewSubmittedPayload', {
  rating: t.int32().min(1).max(5),
  text: t.string().minLength(1).maxLength(2000),
});

export const ChannelError = t.model('ChannelError', {
  code: t.string(),
  message: t.string(),
});
```

Notice that `Review` is a full aggregate (`.identity()` + primary key) while `ReviewSubmittedPayload` is the wire shape a client sends over the channel. Keeping them separate lets the channel accept lean inputs while still broadcasting the full persisted review.

Add a `reviews` table to your Drizzle schema via `triad db generate` or by adding the equivalent `CREATE TABLE` to your inline DDL. Then create a minimal `src/repositories/review.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import type { Infer } from '@triad/core';
import type { Db } from '../db/client.js';
import { reviews } from '../db/schema.js';
import type { Review as ReviewSchema } from '../schemas/review.js';

type Review = Infer<typeof ReviewSchema>;

export interface CreateReviewInput {
  bookId: string;
  authorId: string;
  authorName: string;
  rating: number;
  text: string;
}

export class ReviewRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateReviewInput): Promise<Review> {
    const row = {
      id: crypto.randomUUID(),
      bookId: input.bookId,
      authorId: input.authorId,
      authorName: input.authorName,
      rating: input.rating,
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(reviews).values(row).run();
    return row;
  }

  async listForBook(bookId: string): Promise<Review[]> {
    return this.db
      .select()
      .from(reviews)
      .where(eq(reviews.bookId, bookId))
      .orderBy(asc(reviews.createdAt))
      .all();
  }
}
```

Wire it into `createServices` as `reviewRepo` — same pattern as `bookRepo` and `userRepo` in step 5.

## 2. Declare the channel

Create `src/channels/book-reviews.ts`:

```ts
import { channel, scenario, t } from '@triad/core';
import {
  ChannelError,
  Review,
  ReviewSubmittedPayload,
} from '../schemas/review.js';
import { parseBearer } from '../auth.js';

interface BookReviewsState {
  userId: string;
  userName: string;
  bookId: string;
}

export const bookReviews = channel({
  name: 'bookReviews',
  path: '/ws/books/:bookId/reviews',
  summary: 'Real-time review notifications for a book',
  description:
    'Clients connect to a specific book and receive a broadcast whenever any connected client posts a new review. Authentication is by bearer token passed as the `authorization` header on the upgrade request.',
  tags: ['Reviews'],

  // Phantom witness for typed ctx.state — the value is ignored, only
  // the type matters. Without this, ctx.state is Record<string, any>.
  state: {} as BookReviewsState,

  connection: {
    params: {
      bookId: t.string().format('uuid').doc('Book to subscribe to'),
    },
    headers: {
      authorization: t.string().doc('Bearer <token>'),
    },
  },

  clientMessages: {
    submitReview: {
      schema: ReviewSubmittedPayload,
      description: 'Post a new review for this book',
    },
  },

  serverMessages: {
    review: { schema: Review, description: 'A new review was posted' },
    error: { schema: ChannelError, description: 'Error handling a client message' },
  },

  onConnect: async (ctx) => {
    // Channels do NOT participate in the endpoint beforeHandler pipeline
    // in v1 — the auth check has to live here, in the channel's own
    // onConnect. This is intentional: WebSocket handshakes have different
    // failure semantics than HTTP requests, and wiring a shared hook would
    // hide that difference.
    const token = parseBearer(ctx.headers.authorization);
    if (!token) {
      return ctx.reject(401, 'Missing or malformed Authorization header.');
    }
    const userId = ctx.services.tokens.lookup(token);
    if (!userId) {
      return ctx.reject(401, 'Invalid token.');
    }
    const user = await ctx.services.userRepo.findById(userId);
    if (!user) {
      return ctx.reject(401, 'User not found.');
    }
    // Verify the book actually exists before accepting the subscription.
    const book = await ctx.services.bookRepo.findById(ctx.params.bookId);
    if (!book) {
      return ctx.reject(404, 'Book not found.');
    }

    ctx.state.userId = user.id;
    ctx.state.userName = user.name;
    ctx.state.bookId = ctx.params.bookId;
  },

  handlers: {
    submitReview: async (ctx, data) => {
      const review = await ctx.services.reviewRepo.create({
        bookId: ctx.state.bookId,
        authorId: ctx.state.userId,
        authorName: ctx.state.userName,
        rating: data.rating,
        text: data.text,
      });
      // Broadcast to every client subscribed to this book — including
      // the sender, so the client UI gets a single source of truth for
      // "the review is in" (no optimistic update / reconcile dance).
      ctx.broadcast.review(review);
    },
  },

  behaviors: [
    scenario('Submitting a review broadcasts it to every subscriber')
      .given('a logged-in user subscribed to a book')
      .setup(async (services) => {
        const alice = await services.userRepo.create({
          email: 'a@a.com',
          password: 'pw',
          name: 'Alice',
        });
        const book = await services.bookRepo.create({
          ownerId: alice.id,
          title: 'Dune',
          author: 'Frank Herbert',
          publishedYear: 1965,
        });
        const token = services.tokens.issue(alice.id);
        return { token, bookId: book.id };
      })
      .params({ bookId: '{bookId}' })
      .headers({ authorization: 'Bearer {token}' })
      .body({ rating: 5, text: 'A masterpiece.' })
      .when('client sends submitReview')
      .then('client receives a review event')
      .and('client receives a review with text "A masterpiece."'),

    scenario('Connections without a token are rejected')
      .given('no credentials are provided')
      .fixtures({ bookId: '00000000-0000-0000-0000-000000000000' })
      .params({ bookId: '{bookId}' })
      .headers({ authorization: '' })
      .when('client connects')
      .then('connection is rejected with code 401'),
  ],
});
```

Walk through the pieces:

- **`state: {} as BookReviewsState`** — the phantom witness pattern. TypeScript can't infer the state type from the same call that binds every other channel generic, so Triad takes a dummy value cast to the state interface and uses its type to type `ctx.state`. Without it, `ctx.state` is `Record<string, any>` and you lose the entire point of typed channels.
- **`onConnect` does the auth work.** Channels don't share Triad's HTTP `beforeHandler` pipeline in v1. Wiring a single `requireAuth` across both was rejected during the phase 10 design because WebSocket upgrade handshakes have different failure modes (`ctx.reject(code, message)` vs a typed 401 response). The channel gets the same `ctx.services.tokens` and `ctx.services.userRepo`, so the code is five lines of the same flavor — just in a different place.
- **`clientMessages` and `serverMessages` are exhaustive maps.** Missing a key that you handle, or handling a key that isn't declared, is a compile error. The `ctx.broadcast.*` / `ctx.send.*` / `ctx.broadcastOthers.*` proxies are derived from `serverMessages`.
- **`ctx.broadcast.review(...)` includes the sender.** Use `ctx.broadcastOthers.review(...)` for "send to every peer except the one that triggered this" (the petstore chat room uses this for typing indicators).

## 3. Add an HTTP companion endpoint

Real-time subscribers are a bonus for clients that want them, but the canonical way to submit a review should also work over plain HTTP. Add a `POST /books/:bookId/reviews` endpoint that writes the review and then broadcasts over the channel.

Create `src/endpoints/reviews.ts`:

```ts
import { checkOwnership, endpoint, scenario, t } from '@triad/core';
import { CreateReview, Review } from '../schemas/review.js';
import { ApiError } from '../schemas/common.js';
import { requireAuth } from '../auth.js';

export const submitReview = endpoint({
  name: 'submitReview',
  method: 'POST',
  path: '/books/:bookId/reviews',
  summary: 'Post a review for a book',
  tags: ['Reviews'],
  beforeHandler: requireAuth,
  request: {
    params: { bookId: t.string().format('uuid') },
    body: CreateReview,
  },
  responses: {
    201: { schema: Review, description: 'Review created' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    404: { schema: ApiError, description: 'Book not found' },
  },
  handler: async (ctx) => {
    const book = await ctx.services.bookRepo.findById(ctx.params.bookId);
    if (!book) {
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No book with id ${ctx.params.bookId}.`,
      });
    }
    const review = await ctx.services.reviewRepo.create({
      bookId: book.id,
      authorId: ctx.state.user.id,
      authorName: ctx.state.user.name,
      rating: ctx.body.rating,
      text: ctx.body.text,
    });
    return ctx.respond[201](review);
  },
  behaviors: [
    scenario('Any authenticated user can review any book')
      .given('alice owns a book and bob is logged in')
      .setup(async (services) => {
        const alice = await services.userRepo.create({ email: 'a@a.com', password: 'pw', name: 'Alice' });
        const bob = await services.userRepo.create({ email: 'b@b.com', password: 'pw', name: 'Bob' });
        const book = await services.bookRepo.create({
          ownerId: alice.id,
          title: 'Dune',
          author: 'Frank Herbert',
          publishedYear: 1965,
        });
        const token = services.tokens.issue(bob.id);
        return { token, bookId: book.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ bookId: '{bookId}' })
      .body({ rating: 5, text: 'Incredible worldbuilding.' })
      .when('I POST /books/{bookId}/reviews')
      .then('response status is 201')
      .and('response body matches Review')
      .and('response body has rating 5'),
  ],
});
```

Note: the HTTP handler does not broadcast. In a real app you would either (a) push the broadcast through a shared event bus so both the HTTP handler and the channel publish into the same stream, or (b) have the HTTP handler call into a domain service that handles persistence + broadcast atomically. Both patterns are discussed in [DDD patterns](../ddd-patterns.md). For the tutorial we keep the two paths separate so the channel's own scenario stays self-contained.

## 4. Register everything

Add a `Reviews` bounded context to `src/app.ts`:

```ts
import { bookReviews } from './channels/book-reviews.js';
import { submitReview } from './endpoints/reviews.js';
import {
  ChannelError,
  CreateReview,
  Review,
  ReviewSubmittedPayload,
} from './schemas/review.js';

// ... existing router + Accounts + Library contexts ...

router.context(
  'Reviews',
  {
    description: 'Book reviews over HTTP and real-time channels.',
    models: [Review, CreateReview, ReviewSubmittedPayload, ChannelError, ApiError],
  },
  (ctx) => {
    ctx.add(submitReview, bookReviews);
  },
);
```

A bounded context can hold **both** HTTP endpoints and WebSocket channels. The `Reviews` context is the first one in the tutorial that mixes them. `ctx.add(submitReview, bookReviews)` accepts both kinds of objects because `router.add` is polymorphic over endpoint and channel shapes.

## 5. Install the Fastify WebSocket peer

```bash
npm install @fastify/websocket
```

The Fastify Triad plugin will throw a targeted error if your router has channels but `@fastify/websocket` isn't installed. No other code changes are needed — `triadPlugin` detects channels on the router and registers the WebSocket adapter automatically.

## 6. Run tests

```bash
npx triad test
```

You should see the new HTTP review scenario pass, plus the two channel scenarios. Channel scenarios run through a separate in-process test harness (`runChannelBehaviors`) that constructs a synthetic client, invokes `onConnect` with the declared headers and params, sends the configured `clientMessage` payloads, and collects the server-side broadcasts. The assertion phrases `client receives a review event`, `client receives a review with text "..."`, and `connection is rejected with code 401` are the channel equivalents of the HTTP response assertions — see [step 3](03-testing.md#6-the-assertion-phrase-reference) and the [AI agent guide §5.6](../ai-agent-guide.md#56-channel-assertion-phrases) for the full list.

## 7. Generate AsyncAPI

```bash
npx triad docs
```

Because your router now has both endpoints and channels, `triad docs` writes **two** files: `generated/openapi.yaml` (unchanged — the HTTP endpoints) and `generated/asyncapi.yaml` (new — the channels). Open the AsyncAPI file and look for the `/ws/books/{bookId}/reviews` channel:

```yaml
asyncapi: 3.0.0
info:
  title: Bookshelf API
  version: 0.6.0
channels:
  bookReviews:
    address: /ws/books/{bookId}/reviews
    parameters:
      bookId:
        schema:
          type: string
          format: uuid
    messages:
      review:
        payload:
          $ref: '#/components/schemas/Review'
      submitReview:
        payload:
          $ref: '#/components/schemas/ReviewSubmittedPayload'
operations:
  bookReviews/send/submitReview:
    action: send
    channel:
      $ref: '#/channels/bookReviews'
    messages:
      - $ref: '#/channels/bookReviews/messages/submitReview'
  bookReviews/receive/review:
    action: receive
    channel:
      $ref: '#/channels/bookReviews'
    messages:
      - $ref: '#/channels/bookReviews/messages/review'
```

Every client-facing wire format is now documented. A front-end engineer can feed this to an AsyncAPI code generator and get typed client bindings; a tester can point a spec-driven fuzzer at both HTTP and WebSocket surfaces; a product manager can see "this is what the system emits" in Gherkin form (`triad gherkin` produces channel scenarios just like HTTP ones).

## Next up

[Step 7 — Production](07-production.md). Bookshelf is feature-complete. The final step turns it into something you can actually deploy: environment config, structured logging, graceful shutdown, Docker, CI, and deployment options on Fastify (VPS), Express (existing Node stacks), and Hono (edge).
