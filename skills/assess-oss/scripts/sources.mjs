import { SourceError } from './http.mjs';
import { validatePayload } from './validate.mjs';

export async function source(client, record, url, fields, options = {}) {
  try {
    const result = await client.get(url, options);
    validatePayload(url, result.data);
    record.sources.push({ ...result.source, fields });
    return result.data;
  } catch (error) {
    if (!(error instanceof SourceError)) throw error;
    record.warnings.push(error.message);
    return null;
  }
}
