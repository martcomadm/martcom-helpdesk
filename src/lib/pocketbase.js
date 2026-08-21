import PocketBase from 'pocketbase';

const baseUrl = import.meta.env.VITE_POCKETBASE_URL || 'http://127.0.0.1:8090';
export const pb = new PocketBase(baseUrl);

export function currentUser() {
  return pb.authStore.record;
}

export function logout() {
  pb.authStore.clear();
}
