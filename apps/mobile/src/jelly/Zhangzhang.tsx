// The phone's 账账: the shared mascot (packages/jelly) with its screen-reader label in the app's language.
import { Zhangzhang as Shared, ZZ, ZZ_FILES, type ZzState } from '@jelly/Zhangzhang';
import { tr } from '../i18n';

export { ZZ, ZZ_FILES, type ZzState };

export function Zhangzhang({ state, size }: { state: ZzState; size?: number }) {
  return <Shared state={state} size={size} label={tr('账账：{0}', tr(ZZ[state].name))} />;
}
