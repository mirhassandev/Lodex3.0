/**
 * Nexus Manager — Site Preset Registry (Phase 5)
 * Maps known hostnames to optimal download strategies.
 */

'use strict';

const PRESETS = {
  youtube: {
    hosts: ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'],
    protocol: 'ytdl',
    type: 'youtube',
    requiresYtdl: true,
    ext: '.mp4',
  },
  vimeo: {
    hosts: ['vimeo.com', 'www.vimeo.com'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  twitter: {
    hosts: ['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  instagram: {
    hosts: ['instagram.com', 'www.instagram.com'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  reddit: {
    hosts: ['reddit.com', 'www.reddit.com', 'v.redd.it'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  soundcloud: {
    hosts: ['soundcloud.com', 'www.soundcloud.com'],
    protocol: 'ytdl',
    type: 'audio',
    requiresYtdl: true,
    ext: '.mp3',
  },
  dailymotion: {
    hosts: ['dailymotion.com', 'www.dailymotion.com', 'dai.ly', 'dmcdn.net'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  twitch: {
    hosts: ['twitch.tv', 'www.twitch.tv', 'clips.twitch.tv'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  tiktok: {
    hosts: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  facebook: {
    hosts: ['facebook.com', 'www.facebook.com', 'fb.watch', 'fb.com', 'fbcdn.net'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  bilibili: {
    hosts: ['bilibili.com', 'www.bilibili.com', 'b23.tv'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  bandcamp: {
    hosts: ['bandcamp.com'],
    protocol: 'ytdl',
    type: 'audio',
    requiresYtdl: true,
    ext: '.mp3',
  },
  pinterest: {
    hosts: ['pinterest.com', 'pin.it'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  snapchat: {
    hosts: ['snapchat.com'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  linkedin: {
    hosts: ['linkedin.com'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  streamable: {
    hosts: ['streamable.com'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  tumblr: {
    hosts: ['tumblr.com'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
  likee: {
    hosts: ['likee.video', 'likee.com'],
    protocol: 'ytdl',
    type: 'video',
    requiresYtdl: true,
    ext: '.mp4',
  },
};

/**
 * Find a preset matching the given hostname.
 * @param {string} hostname - e.g. "www.youtube.com"
 * @returns {object|null} preset or null
 */
function findPreset(hostname) {
  if (!hostname) return null;
  const lower = hostname.toLowerCase();
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (preset.hosts.some(h => lower === h || lower.endsWith('.' + h))) {
      return { name, ...preset };
    }
  }
  return null;
}

module.exports = { PRESETS, findPreset };
