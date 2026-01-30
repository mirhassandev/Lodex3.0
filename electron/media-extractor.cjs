const { URL } = require('url');

class MediaExtractor {
    static getType(url) {
        try {
            const u = new URL(url);
            const hostname = u.hostname.toLowerCase();
            const pathname = u.pathname.toLowerCase();

            if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'video';
            if (hostname.includes('vimeo.com')) return 'video';
            if (hostname.includes('tiktok.com')) return 'video';
            if (hostname.includes('instagram.com')) return 'video';
            if (hostname.includes('twitch.tv')) return 'video';

            if (pathname.endsWith('.mp3') || pathname.endsWith('.wav') || pathname.endsWith('.flac')) return 'audio';
            if (pathname.endsWith('.mp4') || pathname.endsWith('.mkv') || pathname.endsWith('.webm')) return 'video';
            if (pathname.endsWith('.jpg') || pathname.endsWith('.png') || pathname.endsWith('.gif')) return 'image';
            if (pathname.endsWith('.zip') || pathname.endsWith('.rar') || pathname.endsWith('.7z') || pathname.endsWith('.exe')) return 'archive';
            if (pathname.endsWith('.pdf') || pathname.endsWith('.doc') || pathname.endsWith('.docx')) return 'document';

            return 'document'; // default
        } catch (e) {
            return 'document';
        }
    }

    static getFilename(url) {
        try {
            const u = new URL(url);
            let name = u.pathname.split('/').pop();
            if (!name || name.length < 3) name = 'downloaded_file';
            // Add extension if missing only if we are sure
            return decodeURIComponent(name);
        } catch (e) {
            return 'downloaded_file';
        }
    }
}

module.exports = { MediaExtractor };
