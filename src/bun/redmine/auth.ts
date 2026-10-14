import { RedmineApiError, RedmineClient, assertHttpUrl, type FetchLike } from './client';

export interface SignInResult {
  apiKey: string;
  user: { id: number; login: string; firstname: string; lastname: string };
}

/** How the request is sent, when the runtime supplies its own HTTP client or a timeout. */
export interface SignInTransport {
  fetch?: FetchLike;
  signal?: AbortSignal;
}

/**
 * Exchanges a username and password for the user's Redmine API key.
 * The password is only used for this one request and is not returned or stored.
 */
export async function signInWithPassword(
  baseUrl: string,
  username: string,
  password: string,
  transport: SignInTransport = {}
): Promise<SignInResult> {
  const client = new RedmineClient({ baseUrl: assertHttpUrl(baseUrl), username, password, ...transport });

  let user;
  try {
    ({ user } = await client.getCurrentUser());
  } catch (error) {
    if (error instanceof RedmineApiError && error.status === 401) {
      throw new Error('Invalid username or password.');
    }
    throw error;
  }

  if (!user.api_key) {
    throw new Error(
      'Redmine did not return an API key for this account. Check that the REST API is enabled on the server.'
    );
  }

  return {
    apiKey: user.api_key,
    user: { id: user.id, login: user.login, firstname: user.firstname, lastname: user.lastname }
  };
}
