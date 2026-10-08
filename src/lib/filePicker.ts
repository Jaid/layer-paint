export const imageAccept = 'image/*,.jxl,.svg'

/** Opens the native file dialog for images. Resolves with an empty list when the dialog is canceled. Call it from a user gesture. */
export const pickImageFiles = () => new Promise<Array<File>>(resolve => {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = imageAccept
  input.addEventListener('change', () => resolve([...input.files ?? []]), {once: true})
  input.addEventListener('cancel', () => resolve([]), {once: true})
  input.click()
})
