import * as fs from 'fs'

export function certStringToBuffer(value: any): any {
  if (value == null) return value

  if (Array.isArray(value)) {
    value.map((cert, index) => {
      if (typeof cert === 'string') value[index] = fs.readFileSync(cert)
    })

    return value
  }

  if (typeof value === 'string') return fs.readFileSync(value)

  return value
}