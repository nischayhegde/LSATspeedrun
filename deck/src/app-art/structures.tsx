/* Map-site markers: painted building icons with transparent backgrounds.
   Tier sites follow the campaign's 15 headquarters; rival sites use one of 14
   signature architectures with the rival's monogram on a brass plate. */

import { rivalSiteArt, tierSiteArt } from './assets'

export type SiteArtProps = {
  kind: 'tier' | 'rival'
  tier?: number
  architecture?: string
  mark?: string
  owned?: boolean
}

export function SiteArt({ kind, tier = 0, architecture = 'mega-tower', mark, owned = false }: SiteArtProps) {
  const src = kind === 'tier' ? tierSiteArt(tier) : rivalSiteArt(architecture)
  return (
    <span className={`av-site site-${kind} ${owned ? 'is-owned' : ''}`} aria-hidden="true">
      <img className="av-site-img" src={src} alt="" draggable={false} loading="lazy" />
      {kind === 'rival' && mark && <b className="av-site-mark">{mark}</b>}
      {owned && <i className="av-site-owned-ring" />}
    </span>
  )
}
