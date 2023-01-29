import maptiler from './maptiler';
const fs = require('fs');

export function pixelPadding(lon1, lat1, lon2, lat2, scaleX, scaleY) {

    const q1 = maptiler.latLonToMeters(lon1, lat1);
    const q2 = maptiler.latLonToMeters(lon2, lat2);

    const dy = q2[1] - q1[1];
    const dx = q2[0] - q1[0];

    return [Math.round(dx * scaleX), Math.round(dy * scaleY)];
}

export function getFilesizeInBytes(fileUrl) {
    const stats = fs.statSync(fileUrl);
    return stats['size'];
}

export function removeTransparentTile(fileUrl) {
    fs.unlinkSync(fileUrl);
    console.log('transparent tile, removed!');
}

export function latLonToMeters(west, south) {
    return maptiler.latLonToMeters(west, south);
}

export function getTiles(extent, zoom, cb) {
    return maptiler.getTiles(extent.west, extent.south, extent.east, extent.north, zoom, cb);
}