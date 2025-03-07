'use client'

import { Suspense, use } from 'react'
import type { StreamingMetadataResolvedState } from './types'

const IsomorphicAsyncMetadata =
  typeof window === 'undefined'
    ? (
        require('./server-inserted-metadata') as typeof import('./server-inserted-metadata')
      ).ServerInsertMetadata
    : (
        require('./browser-resolved-metadata') as typeof import('./browser-resolved-metadata')
      ).BrowserResolvedMetadata

export function AsyncMetadata({
  promise,
  nonce,
}: {
  promise: Promise<StreamingMetadataResolvedState>
  nonce?: string
}) {
  return (
    <>
      <IsomorphicAsyncMetadata promise={promise} />
      {/**
       * For chromium based browsers (Chrome, Edge, etc.) and Safari, icons need to stay under <head>
       * to be picked up by the browser. Firefox doesn't have this requirement.
       *
       * Firefox won't work if we insert those icons into head, it will still pick up default favicon.ico.
       * Because of this limitation, we just don't insert for firefox and leave the default behavior for it.
       *
       */}
      <script
        async
        defer
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: `!/firefox/i.test(navigator.userAgent) && \
document.querySelectorAll('body link[rel="icon"], body link[rel="apple-touch-icon"]').forEach(el => document.head.appendChild(el.cloneNode()))`,
        }}
      />
    </>
  )
}

function MetadataOutlet({
  promise,
}: {
  promise: Promise<StreamingMetadataResolvedState>
}) {
  const { error, digest } = use(promise)
  if (error) {
    if (digest) {
      // The error will lose its original digest after passing from server layer to client layer；
      // We recover the digest property here to override the React created one if original digest exists.
      ;(error as any).digest = digest
    }
    throw error
  }
  return null
}

export function AsyncMetadataOutlet({
  promise,
}: {
  promise: Promise<StreamingMetadataResolvedState>
}) {
  return (
    <Suspense fallback={null}>
      <MetadataOutlet promise={promise} />
    </Suspense>
  )
}
