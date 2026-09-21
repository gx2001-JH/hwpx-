// 외부 의존성 없이 ZIP 아카이브를 STORED(비압축) 방식으로 직접 작성한다.
// hwpx는 결국 zip이므로 이것으로 충분하다.
//
// Node 전용 API(Buffer, node:zlib)를 쓰지 않고 표준 Uint8Array/TextEncoder로만
// 구현한다. Netlify(Node)뿐 아니라 Cloudflare Workers처럼 Node 런타임이 아닌
// 곳에서도 그대로 돌아가야 하기 때문이다(zlib.crc32는 Workers에 없다).

const encoder = new TextEncoder();

// CRC-32 (IEEE 802.3). 테이블은 최초 호출 때 한 번만 만든다.
let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c >>> 0;
  }
  return crcTable;
}

function crc32(bytes) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return encoder.encode(String(data));
}

function dosDateTime(date = new Date()) {
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0xf) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function concat(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/**
 * files: [{ name: string, data: string|Uint8Array }, ...]
 * "mimetype" 항목이 있다면(hwpx 관례상) 배열의 첫 번째여야 한다.
 * 반환값: Uint8Array (완성된 zip 파일 전체 바이트)
 */
export function buildZip(files) {
  const { dosTime, dosDate } = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuf = encoder.encode(name);
    const content = toBytes(data);
    const crc = crc32(content);

    const localHeader = new Uint8Array(30);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, content.length, true); // compressed size
    lv.setUint32(22, content.length, true); // uncompressed size
    lv.setUint16(26, nameBuf.length, true);
    lv.setUint16(28, 0, true); // extra length

    localParts.push(localHeader, nameBuf, content);

    const centralHeader = new Uint8Array(46);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, 0, true); // method: stored
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, content.length, true);
    cv.setUint32(24, content.length, true);
    cv.setUint16(28, nameBuf.length, true);
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk number
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset

    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + content.length;
  }

  const centralDirStart = offset;
  const centralDir = concat(centralParts);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // central dir start disk
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralDir.length, true);
  ev.setUint32(16, centralDirStart, true);
  ev.setUint16(20, 0, true); // comment length

  return concat([...localParts, centralDir, eocd]);
}
