import createClient from 'openapi-fetch';
import type { paths } from './api.types';

// Central strictly typed fetch client configured globally per AGENTS.md requirements
export const apiClient = createClient<paths>({
  baseUrl: 'http://localhost:8080', // the Go backend API port
});
