import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { fonts } from '../theme/fonts';
import { getTeamBadge } from '../utils/badges';

// v3 disc: chalk-white circle that takes a real crest image, or shows an
// ink monogram while none is available. If the caller has no badge URL
// (fixture payloads often ship null badges), it resolves one by team name
// via the cached lookup in utils/badges — this is what actually fixes
// "logos not showing up".
export default function TeamBadge({
  url, name, abbr, size = 34,
}: {
  url?: string | null;
  name: string;
  abbr: string;
  size?: number;
}) {
  const [resolved, setResolved] = useState<string | null>(url ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    if (url) { setResolved(url); return; }
    setResolved(null);
    getTeamBadge(name).then(u => { if (alive && u) setResolved(u); }).catch(() => {});
    return () => { alive = false; };
  }, [url, name]);

  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (resolved && !failed) {
    return (
      <View style={[styles.disc, dim]}>
        <Image
          source={{ uri: resolved }}
          style={{ width: size * 0.72, height: size * 0.72 }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      </View>
    );
  }
  return (
    <View style={[styles.disc, dim]}>
      <Text style={[styles.mono, { fontSize: Math.max(8, size * 0.28) }]}>{abbr}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { backgroundColor: '#f5f5f5', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  mono: { fontFamily: fonts.displayExtraBold, color: '#0b0b0b', letterSpacing: 0.3 },
});
