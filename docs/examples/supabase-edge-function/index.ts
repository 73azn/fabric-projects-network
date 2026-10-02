// Entry point of the Edge Function (the logic is in handler.ts so it can be tested).
import { handler } from './handler.ts';

Deno.serve(handler);
