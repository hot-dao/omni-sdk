import { Commitment, Connection, ConnectionConfig } from "@solana/web3.js";

export class Sequential {
  private connections: Connection[];
  private next = 0;

  constructor(connections: Connection[]) {
    this.connections = connections;
  }

  start() {
    this.next = 0;
  }

  *getConnection(): IterableIterator<Connection> {
    while (true) {
      if (this.next > this.connections.length - 1) {
        return null;
      }

      const con = this.connections[this.next];
      this.next++;

      yield con;
    }
  }
}

class AdvancedConnection extends Connection {
  private readonly connections: Connection[];
  private readonly strategy: Sequential;
  private readonly overrides: Map<string, { allowFallback: boolean; connection: Connection }>;

  constructor(endpoints: string[], commitmentOrConfig?: Commitment | ConnectionConfig) {
    // basically don't care about super
    super(endpoints[0] || "", commitmentOrConfig);

    // store connections
    this.connections = endpoints.map((url) => new Connection(url, commitmentOrConfig));
    this.strategy = new Sequential(this.connections);
    this.overrides = new Map();

    // keep reference to this
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    for (const property of Object.getOwnPropertyNames(Connection.prototype)) {
      // @ts-expect-error: --
      if (typeof Connection.prototype[property] !== "function") {
        continue;
      }

      // Remap all functions with a proxy function that does the exact same thing,
      // except it adds a fallback for when something goes wrong
      // @ts-expect-error: --
      if (this[property].constructor.name === "AsyncFunction") {
        // @ts-expect-error: --
        this[property] = async function (...args) {
          return await self.executeWithCallback((con) => {
            // @ts-expect-error: --
            return con[property](...args);
          }, property);
        };

        continue;
      }

      // @ts-expect-error: Do the same for non async functions
      this[property] = function (...args) {
        let lastError;

        // overrides come first, if set
        if (self.overrides.has(property)) {
          const override = self.overrides.get(property);
          if (override) {
            try {
              // @ts-expect-error: --
              return override.connection[property](...args);
            } catch (e) {
              lastError = e;
            }

            if (!override.allowFallback) {
              if (lastError) {
                throw lastError;
              }
            }
          }
        }

        self.strategy.start();
        for (const conn of self.strategy.getConnection()) {
          try {
            // @ts-expect-error: --
            return conn[property](...args);
          } catch (e) {
            lastError = e;
          }
        }

        // re-throw last error
        if (lastError) {
          throw lastError;
        }
      };
    }
  }

  private executeWithCallback = async (callback: (connection: Connection) => Promise<any>, property: string) => {
    // start with main connection, then iterate through all backups
    let lastError;
    // overrides come first, if set
    if (this.overrides.has(property)) {
      const override = this.overrides.get(property);
      if (override) {
        try {
          return await callback(override.connection);
        } catch (e) {
          lastError = e;
        }

        if (!override.allowFallback) {
          if (lastError) {
            throw lastError;
          }
        }
      }
    }

    this.strategy.start();
    for (const conn of this.strategy.getConnection()) {
      try {
        return await callback(conn);
      } catch (e) {
        lastError = e;
      }
    }

    // if we went through all connections and it's still failing, throw the last error
    throw lastError;
  };
}

export default AdvancedConnection;
