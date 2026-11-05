import { ServiceUnavailableException, BadGatewayException } from '@nestjs/common';

/* ================================================================
   MPP → MSPDI converter client.
   Binary .mpp is a closed format; the ONLY maintained, lawful parser is
   mpxj (Java, GPL/commercial). This client posts the file to a small
   mpxj microservice (see converter/README.md) which returns MSPDI XML.
   The URL is configured via MSPROJECT_CONVERTER_URL; when unset, MPP
   imports fail with an actionable error instead of pretending.
   ================================================================ */

const CONVERTER_URL = () => process.env.MSPROJECT_CONVERTER_URL?.replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.MSPROJECT_CONVERTER_TIMEOUT_MS ?? 60000);

export interface ConverterResult {
  xml: string;
}

export const converterClient = {
  isConfigured(): boolean {
    return Boolean(CONVERTER_URL());
  },

  async convert(buffer: Buffer, filename: string): Promise<ConverterResult> {
    const base = CONVERTER_URL();
    if (!base) {
      throw new ServiceUnavailableException(
        'Binary .mpp import requires the mpxj converter service. Set MSPROJECT_CONVERTER_URL (see docs/msproject-import.md) or export MS Project XML (.xml) and import that instead.',
      );
    }
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)]), filename);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/convert`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (res.status === 413) {
        throw new BadGatewayException('The converter rejected the file as too large or unparseable.');
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new BadGatewayException(`The converter could not read this MPP file: ${body.error ?? 'unsupported or encrypted file'}. MS Project files saved with password protection or newer-than-supported versions cannot be imported.`);
      }
      if (!res.ok) {
        throw new BadGatewayException(`Converter service failed (HTTP ${res.status}).`);
      }
      const xml = await res.text();
      if (!xml.includes('<Project')) {
        throw new BadGatewayException('The converter returned an unexpected payload (not MSPDI XML).');
      }
      return { xml };
    } catch (e) {
      if (e instanceof ServiceUnavailableException || e instanceof BadGatewayException) throw e;
      if (e instanceof Error && e.name === 'AbortError') {
        throw new ServiceUnavailableException(`The converter did not respond within ${TIMEOUT_MS / 1000}s. The file may be too complex; try exporting MS Project XML instead.`);
      }
      throw new ServiceUnavailableException(`The converter service is unreachable (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      clearTimeout(timer);
    }
  },
};
