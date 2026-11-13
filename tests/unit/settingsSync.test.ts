import { describe, expect, it } from 'vitest'
import { savedSettings, settingsToApply } from '../../src/app/settingsSync'

const local = { theme: 'auto', lang: 'en' } as const

describe('settings that follow the person', () => {
  it('treats a profile without settings as "nothing saved yet"', () => {
    expect(savedSettings(undefined)).toBeNull()
    expect(savedSettings({})).toBeNull()
    expect(savedSettings({ lang: 'de' })).toEqual({ lang: 'de' })
  })

  it('applies only what differs on this device', () => {
    expect(settingsToApply({ theme: 'dark', lang: 'de' }, local)).toEqual({ theme: 'dark', lang: 'de' })
    expect(settingsToApply({ theme: 'auto', lang: 'en' }, local)).toEqual({})
    // What a profile carries beyond that (the heat ceiling) is not this device's business here.
    expect(settingsToApply({ theme: 'auto', lang: 'en', heatMax: 3 }, local)).toEqual({})
    expect(settingsToApply({ lang: 'de' }, local)).toEqual({ lang: 'de' })
  })

  it('ignores values it does not know, so an odd profile cannot break a device', () => {
    expect(settingsToApply({ theme: 'neon', lang: 'fr' } as never, local)).toEqual({})
  })
})
