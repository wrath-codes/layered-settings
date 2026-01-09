import { Effect } from "effect";
import { BunRuntime } from "@effect/platform-bun";
import {
  Config,
  User,
  SharedConfig,
  ConfigNotFound,
  AuthError,
} from "@layered/core/effect";

const program = Effect.gen(function* () {
  yield* Effect.log("Config Hub starting...");
  yield* Effect.log(`Schemas loaded: Config, User, SharedConfig`);
  yield* Effect.log("Server will be implemented in Phase 6");
  yield* Effect.never;
});

BunRuntime.runMain(program);
