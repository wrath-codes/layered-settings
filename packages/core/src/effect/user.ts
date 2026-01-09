import { Schema } from "effect";

export class User extends Schema.Class<User>("User")({
  id: Schema.String,
  clerkId: Schema.String,
  email: Schema.String,
  name: Schema.String,
  createdAt: Schema.Number,
}) {}

export class AuthenticatedUser extends Schema.Class<AuthenticatedUser>("AuthenticatedUser")({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
}) {}

export class UserInput extends Schema.Class<UserInput>("UserInput")({
  clerkId: Schema.String,
  email: Schema.String,
  name: Schema.String,
}) {}

export type UserType = typeof User.Type;
export type AuthenticatedUserType = typeof AuthenticatedUser.Type;
export type UserInputType = typeof UserInput.Type;

export const decodeUser = Schema.decodeUnknown(User);
export const decodeAuthenticatedUser = Schema.decodeUnknown(AuthenticatedUser);
export const decodeUserInput = Schema.decodeUnknown(UserInput);
