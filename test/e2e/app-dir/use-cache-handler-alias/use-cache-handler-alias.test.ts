import { nextTestSetup } from 'e2e-utils'
import { retry } from 'next-test-utils'

describe('use-cache-handler-alias', () => {
  const { next, skipped } = nextTestSetup({
    files: __dirname,
    // Skip deployment so we can test the custom cache handlers log output
    skipDeployment: true,
  })

  if (skipped) return

  it('should use cache handler alias if provided', async () => {
    const outputIndex = next.cliOutput.length
    const browser = await next.browser(`/`)
    const initialData = await Promise.all(
      (await browser.elementsByCss('[data-item]')).map((el) => el.textContent())
    )
    for (const data of initialData) {
      expect(data).toMatch(/^\d+\.\d+$/)
    }

    expect(next.cliOutput.slice(outputIndex)).toContain(
      'CustomCacheHandler::Get'
    )
    expect(next.cliOutput.slice(outputIndex)).toContain(
      'CustomCacheHandler::Set'
    )

    let revalidateData = initialData
    await browser.elementById('revalidate-custom').click()
    await browser.refresh()
    revalidateData = await Promise.all(
      (await browser.elementsByCss('[data-item]')).map((el) => el.textContent())
    )
    for (const data of revalidateData) {
      expect(data).toMatch(/^\d+\.\d+$/)
    }
    expect(revalidateData).not.toEqual(initialData)
    expect(next.cliOutput.slice(outputIndex)).toContain(
      `CustomCacheHandler::ExpireTags [ 'custom' ]`
    )
    expect(
      next.cliOutput.split(`CustomCacheHandler::ExpireTags [ 'custom' ]`).length
    ).toEqual(2)

    await retry(async () => {
      await browser.refresh()
      const retryData = await Promise.all(
        (await browser.elementsByCss('[data-item]')).map((el) =>
          el.textContent()
        )
      )
      for (const data of retryData) {
        expect(data).toMatch(/^\d+\.\d+$/)
      }
      expect(retryData).not.toEqual(revalidateData)
    })
  })
})
