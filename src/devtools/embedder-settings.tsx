import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { initEmbedder } from '@/lib/embeddings'
import { useState } from 'react'

export default function EmbedderSettingsSection() {
  const [isInitializing, setIsInitializing] = useState<boolean>(false)
  const [status, setStatus] = useState<string>('')
  const [isInitialized, setIsInitialized] = useState<boolean>(false)

  const handleInitEmbedder = async () => {
    setIsInitializing(true)
    setStatus('Initializing embedder...')
    try {
      await initEmbedder()
      setStatus('Embedder initialized successfully!')
      setIsInitialized(true)
    } catch (error) {
      console.error('Error initializing embedder:', error)
      setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsInitializing(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Embedder Settings</CardTitle>
        <CardDescription>Initialize the embedding model before generating embeddings</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button onClick={handleInitEmbedder} disabled={isInitializing || isInitialized}>
              {isInitializing ? 'Initializing...' : isInitialized ? 'Initialized' : 'Initialize Embedder'}
            </Button>
          </div>
        </div>

        {status && (
          <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-md">
            <div className="text-sm">{status}</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
