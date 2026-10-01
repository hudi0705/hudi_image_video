import { describe, expect, it } from 'vitest'
import { getShotImageMime, parseShotProjectFolder } from './shotProjectImport'

function file(path: string, type = '') {
  return { name: path.split('/').pop()!, webkitRelativePath: path, type } as File
}

describe('parseShotProjectFolder', () => {
  it('imports shot folders in numeric order and sorts alternative frames naturally', () => {
    const result = parseShotProjectFolder([
      file('项目/镜头10/image.png'), file('项目/镜头2/image10.jpg'),
      file('项目/镜头1/image.PNG'), file('项目/镜头2/image2.jpg'),
      file('项目/镜头-23/成图/image.webp'),
    ])
    expect(result.projectName).toBe('项目')
    expect(result.shots.map((shot) => shot.index)).toEqual([1, 2, 10, 23])
    expect(result.shots[1].files.map((image) => image.name)).toEqual(['image2.jpg', 'image10.jpg'])
  })

  it('ignores metadata, hidden files, unrelated images, videos and invalid shot numbers', () => {
    const result = parseShotProjectFolder([
      file('项目/镜头1/frame.png'), file('项目/镜头1/video.mp4'),
      file('项目/镜头1/提示词.txt'), file('项目/镜头1/.preview.png'),
      file('项目/__MACOSX/镜头1/frame.png'), file('项目/参考/image.png'),
      file('项目/封面.jpg'), file('项目/镜头0/image.png'),
      file('项目/镜头9007199254740992/image.png'),
    ])
    expect(result.shots.map((shot) => shot.index)).toEqual([1])
    expect(result.shots[0].files).toHaveLength(1)
    expect(result.ignoredImages).toBe(4)
  })

  it('requires a project folder and supports images with missing browser MIME types', () => {
    expect(parseShotProjectFolder([file('image.png')]).shots).toEqual([])
    expect(parseShotProjectFolder([file('项目/说明.txt')]).shots).toEqual([])
    expect(getShotImageMime(file('项目/镜头1/image.JPEG'))).toBe('image/jpeg')
    expect(getShotImageMime(file('项目/镜头1/notes.txt', 'image/png'))).toBe('')
  })
})
