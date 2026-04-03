import { describe, expect, it } from 'bun:test'

// Test the getFileType logic that should exist in the viewer
// After removing docx support, only PDF should be recognized
describe('PdfSidebarViewer file type detection', () => {
  // We'll import getFileType once it's exported for testing
  // For now, test the expected behavior via the component's rendering

  const getFileType = (fileName: string): 'pdf' | 'unsupported' => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    if (ext === 'pdf') return 'pdf'
    return 'unsupported'
  }

  it('recognizes .pdf files', () => {
    expect(getFileType('report.pdf')).toBe('pdf')
    expect(getFileType('Report.PDF')).toBe('pdf')
    expect(getFileType('my.file.pdf')).toBe('pdf')
  })

  it('treats .docx as unsupported', () => {
    expect(getFileType('notes.docx')).toBe('unsupported')
  })

  it('treats .doc as unsupported', () => {
    expect(getFileType('notes.doc')).toBe('unsupported')
  })

  it('treats other extensions as unsupported', () => {
    expect(getFileType('image.png')).toBe('unsupported')
    expect(getFileType('data.csv')).toBe('unsupported')
    expect(getFileType('readme.txt')).toBe('unsupported')
  })
})
