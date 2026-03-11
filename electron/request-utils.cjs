/**
 * Nexus Manager — Request Utilities
 * Robust HTTP/HTTPS request wrapper with redirect following and timeout support.
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const MAX_REDIRECTS = 5;

/**
 * Perform an HTTP/HTTPS request and follow redirects.
 * 
 * @param {string|URL} url - The target URL
 * @param {object} options - Request options (headers, method, etc.)
 * @param {number} redirectCount - Current recursion depth
 * @returns {Promise<http.IncomingMessage & { finalUrl: string }>}
 */
async function requestWithRedirect(url, options = {}, redirectCount = 0) {
    if (redirectCount >= MAX_REDIRECTS) {
        throw new Error('Too many redirects');
    }

    const urlObj = typeof url === 'string' ? new URL(url) : url;
    const lib = urlObj.protocol === 'https:' ? https : http;

    // Prepare options for this specific hop
    const currentHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        ...options.headers
    };

    const currentOptions = {
        ...options,
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || undefined,
        path: urlObj.pathname + urlObj.search,
        headers: currentHeaders
    };

    return new Promise((resolve, reject) => {
        const req = lib.request(currentOptions, async (res) => {
            const isRedirect = [301, 302, 303, 307, 308].includes(res.statusCode);

            if (isRedirect && res.headers.location) {
                res.resume(); // Cleanly discard current response body
                let nextUrl = res.headers.location;
                
                // Handle relative redirects
                if (!nextUrl.startsWith('http')) {
                    nextUrl = new URL(nextUrl, urlObj.href).href;
                }

                // SECURITY: Remove Sensitive Headers on Cross-Domain Redirects
                const nextUrlObj = new URL(nextUrl);
                const nextOptions = { ...options };
                if (nextUrlObj.host !== urlObj.host) {
                    const filteredHeaders = { ...options.headers };
                    delete filteredHeaders['authorization'];
                    delete filteredHeaders['cookie'];
                    // We keep Referer and User-Agent as they are usually required for CDNs
                    nextOptions.headers = filteredHeaders;
                }

                try {
                    const redirectedRes = await requestWithRedirect(nextUrl, nextOptions, redirectCount + 1);
                    resolve(redirectedRes);
                } catch (err) {
                    reject(err);
                }
                return;
            }

            // Attach final URL for reference
            res.finalUrl = urlObj.href;
            resolve(res);
        });

        req.on('error', reject);
        
        if (options.timeout) {
            req.setTimeout(options.timeout, () => {
                req.destroy();
                reject(new Error('Request Timeout'));
            });
        }

        if (options.body) {
            req.write(options.body);
        }
        
        req.end();
    });
}

/**
 * Concise HEAD request with redirect following.
 */
async function headWithRedirect(url, headers = {}, timeout = 10000) {
    const res = await requestWithRedirect(url, { method: 'HEAD', headers, timeout });
    const size = parseInt(res.headers['content-length'] || '0', 10);
    const acceptRanges = (res.headers['accept-ranges'] || '').toLowerCase() === 'bytes';
    const mime = (res.headers['content-type'] || '').split(';')[0].trim();
    const disposition = res.headers['content-disposition'] || '';
    
    res.resume(); // HEAD body is empty anyway, but good practice
    return { 
        size, 
        acceptRanges, 
        mime, 
        disposition, 
        statusCode: res.statusCode, 
        finalUrl: res.finalUrl,
        headers: res.headers 
    };
}

/**
 * Fetch text content with redirect following.
 */
async function fetchTextWithRedirect(url, headers = {}, timeout = 10000) {
    const res = await requestWithRedirect(url, { method: 'GET', headers, timeout });
    if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        throw new Error(`HTTP Error ${res.statusCode} while fetching text`);
    }

    const finalUrl = res.finalUrl;
    return new Promise((resolve, reject) => {
        let data = '';
        res.on('data', chunk => data += chunk.toString());
        res.on('end', () => resolve({ text: data, finalUrl }));
        res.on('error', reject);
    });
}

/**
 * Fetch buffer content with redirect following.
 */
async function fetchBufferWithRedirect(url, headers = {}, timeout = 30000) {
    const res = await requestWithRedirect(url, { method: 'GET', headers, timeout });
    if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        throw new Error(`HTTP Error ${res.statusCode} while fetching buffer`);
    }

    const finalUrl = res.finalUrl;
    return new Promise((resolve, reject) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks), finalUrl }));
        res.on('error', reject);
    });
}

module.exports = { requestWithRedirect, headWithRedirect, fetchTextWithRedirect, fetchBufferWithRedirect };
