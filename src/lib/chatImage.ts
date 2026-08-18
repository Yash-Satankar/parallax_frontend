export type ChatImagePayload = {
  name: string
  mime: string
  data: string
  preview: string
}

const MAX_IMAGES = 6
const MAX_EDGE = 1600
const JPEG_QUALITY = 0.86

export function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name)
}

export async function filesToChatImages(files: File[]) {
  const images: ChatImagePayload[] = []
  for (const file of files) {
    if (!isImageFile(file)) continue
    images.push(await encodeChatImage(file))
    if (images.length >= MAX_IMAGES) break
  }
  return images
}

export async function encodeChatImage(file: File): Promise<ChatImagePayload> {
  const source = await readDataURL(file)
  const resized = await resizeDataURL(source, file.type)
  return {
    name: file.name || 'image.jpg',
    mime: resized.mime,
    data: resized.data,
    preview: resized.data,
  }
}

function readDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the image'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}

async function resizeDataURL(dataURL: string, type: string) {
  if (typeof createImageBitmap !== 'function') {
    return { mime: type || 'image/jpeg', data: dataURL }
  }
  const blob = dataURLToBlob(dataURL)
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return { mime: type || 'image/jpeg', data: dataURL }
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const mime = type === 'image/png' && scale === 1 ? 'image/png' : 'image/jpeg'
  const data = canvas.toDataURL(mime, JPEG_QUALITY)
  return { mime, data }
}

function dataURLToBlob(dataURL: string) {
  const [header, body] = dataURL.split(',')
  const mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg'
  const bytes = atob(body || '')
  const buffer = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i)
  return new Blob([buffer], { type: mime })
}

export function revokeChatImages(images: ChatImagePayload[]) {
  for (const image of images) {
    if (image.preview.startsWith('blob:')) URL.revokeObjectURL(image.preview)
  }
}
