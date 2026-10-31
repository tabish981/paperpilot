import http from 'http';

/**
 * Pure TypeScript RFC 8010 & RFC 8011 Internet Printing Protocol (IPP 2.0) Binary Engine.
 *
 * Encodes and decodes IPP binary packets:
 * 2 bytes: Version (0x0200 for IPP 2.0)
 * 2 bytes: Operation ID (e.g. 0x0002 for Print-Job) or Status Code
 * 4 bytes: Request ID
 * Tag-based Attribute Groups:
 *   - 0x01: Operation attributes tag
 *   - 0x02: Job attributes tag
 *   - 0x03: End-of-attributes tag
 * Followed by optional raw document stream payload.
 */

export const IPP_VERSION_2_0 = 0x0200;

export const IPP_OPERATIONS = {
  PRINT_JOB: 0x0002,
  VALIDATE_JOB: 0x0004,
  CREATE_JOB: 0x0005,
  SEND_DOCUMENT: 0x0006,
  CANCEL_JOB: 0x0008,
  GET_JOB_ATTRIBUTES: 0x0009,
  GET_JOBS: 0x000a,
  GET_PRINTER_ATTRIBUTES: 0x000b,
};

export const IPP_STATUS_CODES = {
  SUCCESSFUL_OK: 0x0000,
  CLIENT_ERROR_BAD_REQUEST: 0x0400,
  CLIENT_ERROR_FORBIDDEN: 0x0401,
  CLIENT_ERROR_NOT_FOUND: 0x0406,
  CLIENT_ERROR_NOT_POSSIBLE: 0x0404,
  SERVER_ERROR_INTERNAL_ERROR: 0x0500,
  SERVER_ERROR_BUSY: 0x0507,
  SERVER_ERROR_JOB_CANCELED: 0x0508,
};

export const IPP_TAGS = {
  OPERATION_ATTRIBUTES: 0x01,
  JOB_ATTRIBUTES: 0x02,
  END_OF_ATTRIBUTES: 0x03,
  PRINTER_ATTRIBUTES: 0x04,
  UNSUPPORTED_ATTRIBUTES: 0x05,

  // Value Tags
  INTEGER: 0x21,
  BOOLEAN: 0x22,
  ENUM: 0x23,
  OCTET_STRING: 0x30,
  DATETIME: 0x31,
  RESOLUTION: 0x32,
  RANGE_OF_INTEGER: 0x33,
  TEXT_WITH_LANGUAGE: 0x35,
  NAME_WITH_LANGUAGE: 0x36,
  TEXT_WITHOUT_LANGUAGE: 0x41,
  NAME_WITHOUT_LANGUAGE: 0x42,
  KEYWORD: 0x44,
  URI: 0x45,
  URI_SCHEME: 0x46,
  CHARSET: 0x47,
  NATURAL_LANGUAGE: 0x48,
  MIME_MEDIA_TYPE: 0x49,
};

export interface IppAttribute {
  tag: number;
  name: string;
  value: string | number | boolean;
}

export interface IppMessage {
  version?: number;
  operationIdOrStatus: number;
  requestId: number;
  operationAttributes: IppAttribute[];
  jobAttributes?: IppAttribute[];
  data?: Buffer;
}

export class IppProtocol {
  /**
   * Encodes an IPP message into a binary Buffer.
   */
  public static encode(msg: IppMessage): Buffer {
    const chunks: Buffer[] = [];

    // Header: Version (2B) + Operation/Status (2B) + RequestID (4B)
    const header = Buffer.alloc(8);
    header.writeUInt16BE(msg.version || IPP_VERSION_2_0, 0);
    header.writeUInt16BE(msg.operationIdOrStatus, 2);
    header.writeUInt32BE(msg.requestId, 4);
    chunks.push(header);

    // Operation Attributes Group (Tag 0x01)
    if (msg.operationAttributes && msg.operationAttributes.length > 0) {
      chunks.push(Buffer.from([IPP_TAGS.OPERATION_ATTRIBUTES]));
      for (const attr of msg.operationAttributes) {
        chunks.push(IppProtocol.encodeAttribute(attr));
      }
    }

    // Job Attributes Group (Tag 0x02)
    if (msg.jobAttributes && msg.jobAttributes.length > 0) {
      chunks.push(Buffer.from([IPP_TAGS.JOB_ATTRIBUTES]));
      for (const attr of msg.jobAttributes) {
        chunks.push(IppProtocol.encodeAttribute(attr));
      }
    }

    // End of Attributes Tag (0x03)
    chunks.push(Buffer.from([IPP_TAGS.END_OF_ATTRIBUTES]));

    // Optional Document Binary Payload
    if (msg.data && msg.data.length > 0) {
      chunks.push(msg.data);
    }

    return Buffer.concat(chunks);
  }

  /**
   * Decodes an incoming binary Buffer into an IppMessage.
   */
  public static decode(buf: Buffer): IppMessage {
    if (buf.length < 9) {
      throw new Error(`Buffer too short for IPP header (${buf.length} bytes)`);
    }

    const version = buf.readUInt16BE(0);
    const operationIdOrStatus = buf.readUInt16BE(2);
    const requestId = buf.readUInt32BE(4);

    let offset = 8;
    let currentGroupTag = 0;
    const operationAttributes: IppAttribute[] = [];
    const jobAttributes: IppAttribute[] = [];

    while (offset < buf.length) {
      const tag = buf[offset++];
      if (tag === IPP_TAGS.END_OF_ATTRIBUTES) {
        break;
      }

      if (tag <= 0x0f) {
        // Delimiter tag
        currentGroupTag = tag;
        continue;
      }

      // Value tag: Read attribute name length
      const nameLength = buf.readUInt16BE(offset);
      offset += 2;
      const name = buf.toString('utf8', offset, offset + nameLength);
      offset += nameLength;

      // Read attribute value length
      const valueLength = buf.readUInt16BE(offset);
      offset += 2;

      let value: string | number | boolean = '';
      if (tag === IPP_TAGS.INTEGER || tag === IPP_TAGS.ENUM) {
        value = buf.readInt32BE(offset);
      } else if (tag === IPP_TAGS.BOOLEAN) {
        value = buf[offset] === 1;
      } else {
        value = buf.toString('utf8', offset, offset + valueLength);
      }
      offset += valueLength;

      const attr: IppAttribute = { tag, name, value };
      if (currentGroupTag === IPP_TAGS.OPERATION_ATTRIBUTES) {
        operationAttributes.push(attr);
      } else if (currentGroupTag === IPP_TAGS.JOB_ATTRIBUTES) {
        jobAttributes.push(attr);
      }
    }

    // Any remaining bytes are the document stream data
    const data = offset < buf.length ? buf.subarray(offset) : undefined;

    return {
      version,
      operationIdOrStatus,
      requestId,
      operationAttributes,
      jobAttributes,
      data,
    };
  }

  /**
   * Encodes a single attribute: Tag (1B) + NameLen (2B) + Name + ValLen (2B) + Val
   */
  private static encodeAttribute(attr: IppAttribute): Buffer {
    const nameBuf = Buffer.from(attr.name, 'utf8');
    let valBuf: Buffer;

    if (attr.tag === IPP_TAGS.INTEGER || attr.tag === IPP_TAGS.ENUM) {
      valBuf = Buffer.alloc(4);
      valBuf.writeInt32BE(Number(attr.value), 0);
    } else if (attr.tag === IPP_TAGS.BOOLEAN) {
      valBuf = Buffer.from([attr.value ? 1 : 0]);
    } else {
      valBuf = Buffer.from(String(attr.value), 'utf8');
    }

    const header = Buffer.alloc(1 + 2 + nameBuf.length + 2);
    header[0] = attr.tag;
    header.writeUInt16BE(nameBuf.length, 1);
    nameBuf.copy(header, 3);
    header.writeUInt16BE(valBuf.length, 3 + nameBuf.length);

    return Buffer.concat([header, valBuf]);
  }

  /**
   * Transmits an IPP binary request over HTTP POST to the printer at port 631.
   */
  public static sendRequest(
    ip: string,
    port: number,
    pathName: string,
    message: IppMessage,
    timeoutMs: number = 8000
  ): Promise<IppMessage> {
    return new Promise((resolve, reject) => {
      const postData = IppProtocol.encode(message);

      const options: http.RequestOptions = {
        hostname: ip,
        port: port || 631,
        path: pathName || '/ipp/print',
        method: 'POST',
        headers: {
          'Content-Type': 'application/ipp',
          'Content-Length': postData.length,
          'User-Agent': 'PaperPilot/1.0 (Android; HP Smart Tank 580)',
        },
        timeout: timeoutMs,
      };

      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const responseBuf = Buffer.concat(chunks);
            const decoded = IppProtocol.decode(responseBuf);
            resolve(decoded);
          } catch (decodeErr) {
            reject(new Error(`Failed to decode IPP response: ${decodeErr}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`IPP request to ${ip}:${port} timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => {
        reject(new Error(`IPP connection error: ${err.message}`));
      });

      req.write(postData);
      req.end();
    });
  }
}
