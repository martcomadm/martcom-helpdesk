import PocketBase from 'pocketbase';

const baseUrl = import.meta.env.VITE_POCKETBASE_URL || 'http://127.0.0.1:8090';
export const pb = new PocketBase(baseUrl);

// The Helpdesk performs normal refreshes and realtime refreshes in parallel.
// PocketBase cancels duplicate in-flight requests by default, which can surface
// harmless ClientResponseError abort messages in the UI. We prefer allowing
// these reads to complete independently because the screens merge realtime data.
pb.autoCancellation(false);

export function currentUser() {
  return pb.authStore.record;
}

export function logout() {
  pb.authStore.clear();
}
