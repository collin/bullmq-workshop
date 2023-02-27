import http from "http";
import { Job, Queue } from "bullmq";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import express from "express";
import morgan from "morgan";
import { faker } from "@faker-js/faker";
import { redisConnection } from "./redisConnection";

import { makeExecutableSchema } from "@graphql-tools/schema";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import cors from "cors";
import { Client, Pool } from "pg";
import {
  ASTNode,
  FieldNode,
  GraphQLResolveInfo,
  Kind,
  OperationDefinitionNode,
  SelectionSetNode,
} from "graphql";

const pool = new Pool({
  connectionString: "postgres://postgres:postgres@postgres:5432/publisher",
});

// A schema is a collection of type definitions (hence "typeDefs")
// that together define the "shape" of queries that are executed against
// your data.
const typeDefs = `#graphql
  # Comments in GraphQL strings (such as this one) start with the hash (#) symbol.

  type Book {
    id: ID!
    title: String!
    authors: [Author]!
  }

  type Author {
    id: ID!
    name: String!
    books: [Book]!
  }

  type Queue {
    name: String
    active_count: Int
    waiting_count: Int
    failed_count: Int
    completed_count: Int
    delayed_count: Int
    completed_jobs(start: Int = 0, limit: Int = undefined): [Job]
    all_jobs(start: Int = 0, limit: Int = undefined, status: [JobStatus] = ALL): [Job]
  }

  enum JobStatus {
    ALL
    ACTIVE
    COMPLETED
    DELAYED
    FAILED
    PAUSED
    REPEAT
    WAIT
    WAITING
    WAITING_CHILDREN
  }

  scalar Object
  scalar timestamptz

  # This "Book" type defines the queryable fields for every book in our data source.
  type Job {
    id: ID
    name: String
    status: String
    data: Object
    return_value: Object
    progress: Float
    stacktrace: [String]
    logs: [String]
    attempts: Int
    added_at: timestamptz
    started_at: timestamptz
    finished_at: timestamptz
    failed_reason: String
    is_failed: Boolean
    is_completed: Boolean
    is_active: Boolean
    is_delayed: Boolean
    is_waiting: Boolean
  }

  # The "Query" type is special: it lists all of the available queries that
  # clients can execute, along with the return type for each. In this
  # case, the "books" query returns an array of zero or more Books (defined above).
  type Query {
    queues: [Queue]!
    queue(name: String!): Queue
    authors: [Author]!
    books: [Book]!
  }

  type QueueEvent {
    id: String
  }

  type Subscription {
    queueEvent(name: String): QueueEvent
  }
`;

const queues: Record<string, Queue> = {};
const getQueue = (name: string) =>
  (queues[name] ||= new Queue(name, { sharedConnection: true, connection: redisConnection }));

const tableSpace: Record<string, Record<string, "field" | "table">> = {
  books: {
    id: "field",
    title: "field",
    authors: "table",
  },
  authors: {
    id: "field",
    name: "field",
    books: "table",
  },
  authorship: {
    author_id: "field",
    book_id: "field",
  },
};

class SQLQueryResolver {
  constructor(private db: Pool | Client, private query: ASTNode) {}

  visit(node: ASTNode) {
    if (node.kind in this) {
      console.log("Visiting", node.kind);
      // @ts-expect-error we've checked this above
      return this[node.kind](node);
    } else {
      console.error("No visitor defined for ", node.kind, node);
      throw new Error("NO VISITOR");
    }
  }

  OperationDefinition(operation: OperationDefinitionNode) {
    return this.visit(operation.selectionSet);
  }

  SelectionSet(set: SelectionSetNode) {
    return set.selections.map((selection) => {
      switch (selection.kind) {
        case Kind.FIELD: {
          return this.visit(selection);
        }
      }
    });
  }

  Field(field: FieldNode) {
    const fieldName = field.name.value;
    const tableDef = tableSpace[field.name.value];
    if (fieldName in tableSpace || tableDef?.[fieldName] === "table") {
      console.log("selectionSet.selection", field.name.value);
      const table = `publisher.${field.name.value}`;
      const fields: string[] = [];
      for (const _selection of field.selectionSet?.selections || []) {
        if (_selection.kind === Kind.FIELD) {
          const fieldName = _selection.name.value;
          fields.push(`'${fieldName}'`);
          fields.push(this.visit(_selection));
        }
      }
      const statement = `(select json_agg(json_build_object(${fields.join(",")})) as ${
        field.name.value
      } from ${table})`;
      return statement;
    } else {
      return fieldName;
    }
  }

  pluck(key: string) {
    return new Promise(async (resolve, reject) => {
      try {
        const { rows } = await this.db.query(this.toSQL());
        resolve(rows[0][key]);
      } catch (error) {
        reject(error);
      }
    });
  }

  toSQL() {
    return this.visit(this.query);
  }
}

// Resolvers define how to fetch the types defined in your schema.
// This resolver retrieves books from the "books" array above.
const resolvers: { [key: string]: any; Job: Record<string, (job: Job) => unknown> } = {
  Query: {
    async authors(_, __, ___, info: GraphQLResolveInfo) {
      return new SQLQueryResolver(pool, info.fieldNodes[0]).pluck("authors");
    },
    async books(_, __, ___, info: GraphQLResolveInfo) {
      return new SQLQueryResolver(pool, info.fieldNodes[0]).pluck("books");
    },
    queues() {
      return [{ name: "say-hello" }];
    },
    queue(_: any, args: any) {
      return getQueue(args.name);
    },
  },
  Subscription: {
    queueEvent: (a: any, b: any, c: any) => {
      console.log("a", a);
      console.log("b", b);
      console.log("c", c);
    },
  },
  JobStatus: {
    ALL: [
      "active",
      "completed",
      "delayed",
      "failed",
      "paused",
      "repeat",
      "wait",
      "waiting",
      "waiting-children",
    ],
    ACTIVE: "active",
    COMPLETED: "completed",
    DELAYED: "delayed",
    FAILED: "failed",
    PAUSED: "paused",
    REPEAT: "repeat",
    WAIT: "wait",
    WAITING: "waiting",
    WAITING_CHILDREN: "waiting-children",
  },
  Job: {
    id: (job) => job.id,
    name: (job) => job.name,
    status: (job) => job.getState(),
    data: (job) => job.data,
    progress: (job) => job.progress,
    stacktrace: (job) => job.stacktrace,
    logs: async (job) =>
      // @ts-expect-error unsure why this never[] type is in here, appears to work
      (await (job.id ? getQueue(job.queueName).getJobLogs(job.id) : []))?.logs || [],
    return_value: (job) => job.returnvalue,
    added_at: (job) => job.timestamp,
    started_at: (job) => job.processedOn,
    finished_at: (job) => job.finishedOn,
    failed_reason: (job) => job.failedReason,
    is_failed: (job) => job.isFailed(),
    is_completed: (job) => job.isCompleted(),
    is_active: (job) => job.isActive(),
    is_delayed: (job) => job.isDelayed(),
    is_waiting: (job) => job.isWaiting(),
    attempts: (job) => job.attemptsMade,
  },
  Queue: {
    waiting_count(parent: { name: string }) {
      return getQueue(parent.name).getWaitingCount();
    },

    active_count(parent: { name: string }) {
      return getQueue(parent.name).getActiveCount();
    },

    completed_count(parent: { name: string }) {
      return getQueue(parent.name).getCompletedCount();
    },

    failed_count(parent: { name: string }) {
      return getQueue(parent.name).getFailedCount();
    },

    delayed_count(parent: { name: string }) {
      return getQueue(parent.name).getDelayedCount();
    },

    completed_jobs(parent: { name: string }, _args: unknown, contextValue: unknown) {
      if (_args.limit === 0) {
        throw new Error("Limit 0 is too small.");
      }
      const end = _args.limit ? _args.start - 1 + _args.limit : 10;
      return getQueue(parent.name).getCompleted(_args.start, end);
    },

    all_jobs(parent: { name: string }, _args: unknown, contextValue: unknown) {
      if (_args.limit === 0) {
        throw new Error("Limit 0 is too small.");
      }
      const end = _args.limit ? _args.start - 1 + _args.limit : 10;
      return getQueue(parent.name).getJobs(
        Array.from(new Set(_args.status.flat())),
        _args.start,
        end
      );
    },
  },
};

const BASE_PATH = process.env.BASE_PATH || "/";

async function main() {
  await pool.query(/* sql */ `
    create schema if not exists publisher;
    drop schema publisher cascade;
    create schema publisher;

    create table publisher.books (
      id serial primary key,
      title text not null
    );

    create table publisher.authors (
      id serial primary key,
      name text not null
    );

    create table publisher.authorship (
      book_id integer not null,
      author_id integer not null,
      foreign key (book_id) references publisher.books(id),
      foreign key (author_id) references publisher.authors(id),
      unique (book_id, author_id)
    );
  `);

  const DB_SIZE = 10;

  for (let i = 0; i < DB_SIZE; i++) {
    await pool.query(
      /* SQL */ `
    insert into publisher.books (title) values ($1)
    `,
      [faker.music.songName()]
    );
    await pool.query(
      /* SQL */ `
    insert into publisher.authors (name) values ($1)
    `,
      [faker.name.fullName()]
    );
  }

  for (let i = 0; i < DB_SIZE * 1.5; i++) {
    await pool.query(
      /* SQL */ `
    insert into publisher.authorship (book_id, author_id) values ($1, $2)
    on conflict do nothing
  `,
      [
        faker.datatype.number({ min: 1, max: DB_SIZE }),
        faker.datatype.number({ min: 1, max: DB_SIZE }),
      ]
    );
  }

  const app = express();
  const httpServer = http.createServer(app);
  app.use(morgan("dev"));
  app.use(cors());

  const schema = makeExecutableSchema({ typeDefs, resolvers });

  // Creating the WebSocket server
  const wsServer = new WebSocketServer({
    // This is the `httpServer` we created in a previous step.
    server: httpServer,
    // Pass a different path here if app.use
    // serves expressMiddleware at a different path
    path: "/graphql",
  });

  // Hand in the schema we just created and have the
  // WebSocketServer start listening.
  const serverCleanup = useServer({ schema }, wsServer);

  // Same ApolloServer initialization as before, plus the drain plugin
  // for our httpServer.
  const apolloServer = new ApolloServer({
    schema,
    plugins: [
      // Proper shutdown for the HTTP server.
      ApolloServerPluginDrainHttpServer({ httpServer }),

      // Proper shutdown for the WebSocket server.
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
    ],
  });

  await apolloServer.start();

  app.use(BASE_PATH, express.json({ limit: "4mb" }), expressMiddleware(apolloServer));

  httpServer.listen(80, "0.0.0.0", () => {
    console.log(`🚀 Server ready at http://0.0.0.0:80/`);
  });
}

main();
