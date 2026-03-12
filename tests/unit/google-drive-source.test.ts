import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

const mockExistsSync = vi.fn();

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: any[]) => mockExistsSync(...args),
  },
  existsSync: (...args: any[]) => mockExistsSync(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/config', () => ({
  config: {
    google: {
      serviceAccountKeyPath: '',
    },
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  parseDriveUri,
  fetchDriveFile,
  listDriveFolder,
  writeGoogleSheet,
  replaceGoogleDocTokens,
  getServiceAccountToken,
} from '../../src/modules/sources/google-drive';
import { config } from '../../src/config';

// ── Helpers ──

function jsonResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function textResponse(text: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(text),
  };
}

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: { message: 'Error' } }),
    text: () => Promise.resolve('Error'),
  };
}

// ── Tests ──

describe('Google Drive Source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── parseDriveUri ──

  describe('parseDriveUri', () => {
    it('should parse Google Docs URL', () => {
      const result = parseDriveUri('https://docs.google.com/document/d/abc123-XYZ/edit');
      expect(result).toEqual({ fileId: 'abc123-XYZ', type: 'doc' });
    });

    it('should parse Google Sheets URL', () => {
      const result = parseDriveUri('https://docs.google.com/spreadsheets/d/sheet_id_456/edit#gid=0');
      expect(result).toEqual({ fileId: 'sheet_id_456', type: 'sheet' });
    });

    it('should parse Drive file URL', () => {
      const result = parseDriveUri('https://drive.google.com/file/d/fileId789/view');
      expect(result).toEqual({ fileId: 'fileId789', type: 'file' });
    });

    it('should treat raw ID as file type', () => {
      const result = parseDriveUri('rawFileId123');
      expect(result).toEqual({ fileId: 'rawFileId123', type: 'file' });
    });

    it('should handle IDs with hyphens and underscores', () => {
      const result = parseDriveUri('https://docs.google.com/document/d/abc-123_XYZ/edit');
      expect(result).toEqual({ fileId: 'abc-123_XYZ', type: 'doc' });
    });

    it('should return original URI when no /d/ pattern matches for drive URL', () => {
      // If the URL contains drive.google.com/file but no /d/ match
      const result = parseDriveUri('https://drive.google.com/file/something');
      // No /d/ match so fileId stays as full uri
      expect(result.type).toBe('file');
    });
  });

  // ── fetchDriveFile ──

  describe('fetchDriveFile', () => {
    it('should fetch Google Doc as plain text', async () => {
      // Metadata response
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 'doc1',
          name: 'My Document',
          mimeType: 'application/vnd.google-apps.document',
        }),
      );
      // Export response
      mockFetch.mockResolvedValueOnce(textResponse('Document content here'));

      const result = await fetchDriveFile('doc1', 'token123');

      expect(result).toEqual({
        id: 'doc1',
        name: 'My Document',
        mimeType: 'application/vnd.google-apps.document',
        content: 'Document content here',
      });

      // Verify metadata request
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/drive/v3/files/doc1?fields='),
        expect.objectContaining({
          headers: { Authorization: 'Bearer token123' },
        }),
      );

      // Verify export request
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/export?mimeType=text/plain'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer token123' },
        }),
      );
    });

    it('should fetch Google Sheet as CSV', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 'sheet1',
          name: 'My Sheet',
          mimeType: 'application/vnd.google-apps.spreadsheet',
        }),
      );
      mockFetch.mockResolvedValueOnce(textResponse('col1,col2\nval1,val2'));

      const result = await fetchDriveFile('sheet1', 'token123');

      expect(result.content).toBe('col1,col2\nval1,val2');
      expect(result.mimeType).toBe('application/vnd.google-apps.spreadsheet');

      // Verify export uses text/csv
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('mimeType=text/csv'),
        expect.any(Object),
      );
    });

    it('should download other file types as text via alt=media', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 'file1',
          name: 'notes.txt',
          mimeType: 'text/plain',
        }),
      );
      mockFetch.mockResolvedValueOnce(textResponse('Plain text file content'));

      const result = await fetchDriveFile('file1', 'token123');

      expect(result.content).toBe('Plain text file content');

      // Verify uses alt=media
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('alt=media'),
        expect.any(Object),
      );
    });

    it('should throw auth error on 401', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401));
      await expect(fetchDriveFile('file1', 'bad-token')).rejects.toThrow(
        'Drive authentication failed (401)',
      );
    });

    it('should throw auth error on 403', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(403));
      await expect(fetchDriveFile('file1', 'expired-token')).rejects.toThrow(
        'Drive authentication failed (403)',
      );
    });

    it('should throw generic error on other status codes', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500));
      await expect(fetchDriveFile('file1', 'token')).rejects.toThrow(
        'Failed to get file metadata: 500',
      );
    });

    it('should include Authorization header in all requests', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ id: 'f', name: 'n', mimeType: 'text/plain' }),
      );
      mockFetch.mockResolvedValueOnce(textResponse('content'));

      await fetchDriveFile('f', 'my-access-token');

      for (const call of mockFetch.mock.calls) {
        expect(call[1].headers.Authorization).toBe('Bearer my-access-token');
      }
    });
  });

  // ── listDriveFolder ──

  describe('listDriveFolder', () => {
    it('should return list of files in folder', async () => {
      const files = [
        { id: 'f1', name: 'File 1', mimeType: 'text/plain' },
        { id: 'f2', name: 'File 2', mimeType: 'application/pdf' },
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse({ files }));

      const result = await listDriveFolder('folder123', 'token');

      expect(result).toEqual(files);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("'folder123'+in+parents"),
        expect.objectContaining({
          headers: { Authorization: 'Bearer token' },
        }),
      );
    });

    it('should throw on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(404));
      await expect(listDriveFolder('bad-folder', 'token')).rejects.toThrow(
        'Failed to list Drive folder: 404',
      );
    });

    it('should return empty array when folder is empty', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ files: [] }));
      const result = await listDriveFolder('empty-folder', 'token');
      expect(result).toEqual([]);
    });
  });

  // ── writeGoogleSheet ──

  describe('writeGoogleSheet', () => {
    it('should PUT values to the Sheets API', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ updatedCells: 4 }));

      await writeGoogleSheet('sheet1', 'Sheet1!A1:B2', [['a', 'b'], ['c', 'd']], 'token');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/spreadsheets/sheet1/values/Sheet1!A1:B2'),
        expect.objectContaining({
          method: 'PUT',
          headers: {
            Authorization: 'Bearer token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: [['a', 'b'], ['c', 'd']] }),
        }),
      );
    });

    it('should include valueInputOption=RAW in URL', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await writeGoogleSheet('s', 'A1', [[]], 'tok');
      expect(mockFetch.mock.calls[0][0]).toContain('valueInputOption=RAW');
    });

    it('should throw on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(403));
      await expect(
        writeGoogleSheet('sheet1', 'A1', [['v']], 'token'),
      ).rejects.toThrow('Failed to write Google Sheet: 403');
    });
  });

  // ── replaceGoogleDocTokens ──

  describe('replaceGoogleDocTokens', () => {
    it('should POST batchUpdate with replaceAllText requests', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ replies: [] }));

      const replacements = { name: 'Alice', role: 'Engineer' };
      await replaceGoogleDocTokens('doc1', replacements, 'token');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/documents/doc1:batchUpdate'),
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer token',
            'Content-Type': 'application/json',
          },
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.requests).toHaveLength(2);
      expect(body.requests[0].replaceAllText.containsText.text).toBe('{{name}}');
      expect(body.requests[0].replaceAllText.replaceText).toBe('Alice');
      expect(body.requests[1].replaceAllText.containsText.text).toBe('{{role}}');
      expect(body.requests[1].replaceAllText.replaceText).toBe('Engineer');
    });

    it('should set matchCase to true', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await replaceGoogleDocTokens('doc1', { key: 'val' }, 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.requests[0].replaceAllText.containsText.matchCase).toBe(true);
    });

    it('should throw on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500));
      await expect(
        replaceGoogleDocTokens('doc1', { k: 'v' }, 'token'),
      ).rejects.toThrow('Failed to update Google Doc: 500');
    });

    it('should handle empty replacements', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await replaceGoogleDocTokens('doc1', {}, 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.requests).toEqual([]);
    });
  });

  // ── getServiceAccountToken ──

  describe('getServiceAccountToken', () => {
    it('should return null when no key path is configured', async () => {
      (config as any).google.serviceAccountKeyPath = '';
      const result = await getServiceAccountToken();
      expect(result).toBeNull();
    });

    it('should return null when key path does not exist', async () => {
      (config as any).google.serviceAccountKeyPath = '/nonexistent/key.json';
      mockExistsSync.mockReturnValue(false);
      const result = await getServiceAccountToken();
      expect(result).toBeNull();
    });

    it('should return null even when key file exists (JWT not implemented)', async () => {
      (config as any).google.serviceAccountKeyPath = '/path/to/key.json';
      mockExistsSync.mockReturnValue(true);
      const result = await getServiceAccountToken();
      // Currently returns null because JWT exchange is not implemented
      expect(result).toBeNull();
    });
  });
});
