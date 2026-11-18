// PhysioCare logo for the apps: the Care Cross mark (PNG from `npm run brand`) + wordmark in Plus Jakarta Sans ExtraBold.
import { Image, Text, View } from 'react-native';
import { F } from './ui';

const MARK = { full: require('../../assets/mark-full.png'), reversed: require('../../assets/mark-reversed.png'), dark: require('../../assets/mark-dark.png') };
const WORD = {
  full: { physio: '#1F1A4D', care: '#5146D9', by: '#5E5A7A' },
  reversed: { physio: '#FFFFFF', care: '#C9C3F7', by: 'rgba(255,255,255,0.8)' },
  dark: { physio: '#FFFFFF', care: '#A99FF5', by: 'rgba(255,255,255,0.7)' },
};

export function Logo({ variant = 'full', size = 34, endorsed = false, suffix }: { variant?: keyof typeof MARK; size?: number; endorsed?: boolean; suffix?: string }) {
  const c = WORD[variant];
  const word = size * 0.72;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`PhysioCare${suffix ? ` ${suffix}` : ''}${endorsed ? ' by Healthtropic' : ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.28 }}>
      <Image source={MARK[variant]} style={{ width: size, height: size }} />
      <View>
        <Text style={{ fontFamily: F.w800, fontSize: word, letterSpacing: -word * 0.025, lineHeight: word * 1.15 }}>
          <Text style={{ color: c.physio }}>Physio</Text><Text style={{ color: c.care }}>Care</Text>
          {suffix ? <Text style={{ color: c.by, fontFamily: F.w600, fontSize: word * 0.55, letterSpacing: 0 }}>{`  ${suffix}`}</Text> : null}
        </Text>
        {endorsed && <Text style={{ color: c.by, fontFamily: F.w600, fontSize: Math.max(9, word * 0.24), letterSpacing: word * 0.06 }}>BY HEALTHTROPIC</Text>}
      </View>
    </View>
  );
}
