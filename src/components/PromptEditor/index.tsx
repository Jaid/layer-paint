import type {Ingredient} from '#src/lib/state.ts'
import type {MonacoApi, MonacoOptions} from 'monacozen'

import Monacozen from 'monacozen'
import {useEffect, useRef} from 'react'

import {setPrompt} from '#src/lib/actions.ts'
import {getDroppedReference, isReferenceDrag} from '#src/lib/collectionDrag.ts'
import {generate} from '#src/lib/generation.ts'
import {findReferences} from '#src/lib/prompt.ts'
import {insertIntoPrompt, registerPromptInserter} from '#src/lib/promptEditor.ts'
import {editorStore, projectStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'
import {useDarkMode} from '#src/lib/useDarkMode.ts'

import css from './style.module.sass'

type StandaloneEditor = ReturnType<MonacoApi['editor']['create']>
type DecorationsCollection = ReturnType<StandaloneEditor['createDecorationsCollection']>

const options: MonacoOptions = {
  padding: {
    top: 14,
    bottom: 14,
  },
  fontSize: 14,
  lineHeight: 21,
  scrollBeyondLastLine: false,
  quickSuggestions: false,
  wordBasedSuggestions: 'off',
  suggestOnTriggerCharacters: true,
  unicodeHighlight: {
    ambiguousCharacters: false,
    invisibleCharacters: false,
  },
  renderWhitespace: 'none',
  fixedOverflowWidgets: true,
  hover: {delay: 200},
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    vertical: 'auto',
    horizontal: 'hidden',
    verticalScrollbarSize: 8,
    useShadows: false,
  },
}
const getIngredients = () => projectStore.state.ingredients
const findIngredient = (index: number): Ingredient | undefined => getIngredients().find(ingredient => ingredient.index === index)
let providersRegistered = false
/** Completion and hover providers are global per language, so they are registered once and read the live store. */
const registerProviders = (monaco: MonacoApi) => {
  if (providersRegistered) {
    return
  }
  providersRegistered = true
  monaco.languages.registerCompletionItemProvider('markdown', {
    triggerCharacters: ['['],
    provideCompletionItems: (model, position) => {
      const before = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })
      const match = /!\[(\d*)$/.exec(before)
      if (!match) {
        return {suggestions: []}
      }
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column - match[0].length,
        endColumn: position.column,
      }
      const canvas = {
        label: '![0]',
        kind: monaco.languages.CompletionItemKind.Reference,
        detail: 'canvas content inside the frame',
        insertText: '![0]',
        range,
        sortText: '0',
      }
      const ingredients = getIngredients().map(ingredient => ({
        label: `![${ingredient.index}]`,
        kind: monaco.languages.CompletionItemKind.File,
        detail: ingredient.name,
        documentation: {
          value: `![${ingredient.name}](${ingredient.thumbnail})`,
          supportHtml: false,
        },
        insertText: `![${ingredient.index}]`,
        range,
        sortText: String(ingredient.index).padStart(4, '0'),
      }))
      return {suggestions: [canvas, ...ingredients]}
    },
  })
  monaco.languages.registerHoverProvider('markdown', {
    provideHover: (model, position) => {
      const line = model.getLineContent(position.lineNumber)
      const reference = findReferences(line).find(token => position.column - 1 >= token.start && position.column - 1 <= token.end)
      if (!reference) {
        return
      }
      const range = new monaco.Range(position.lineNumber, reference.start + 1, position.lineNumber, reference.end + 1)
      const described = reference.description ? [{value: `described as “${reference.description}”`}] : []
      if (reference.index === 0) {
        return {
          range,
          contents: [{value: '**canvas** – everything inside the frame'}, ...described],
        }
      }
      const ingredient = findIngredient(reference.index)
      if (!ingredient) {
        return {
          range,
          contents: [{value: `**![${reference.index}]** does not exist – drop an image onto the editor to add it`}],
        }
      }
      return {
        range,
        contents: [{value: `**${ingredient.name}**`}, ...described, {value: `![${ingredient.name}](${ingredient.thumbnail})`}],
      }
    },
  })
}
const PromptEditor = () => {
  const dark = useDarkMode()
  const prompt = useStore(editorStore, state => state.prompt)
  const ingredients = useStore(projectStore, state => state.ingredients)
  const hoveredIndex = useStore(editorStore, state => state.hoveredCollectionIndex)
  const editorRef = useRef<StandaloneEditor | null>(null)
  const decorationsRef = useRef<DecorationsCollection | null>(null)
  const monacoRef = useRef<MonacoApi | null>(null)
  const cleanupRef = useRef<(() => void) | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  // Collection tiles, the frame view included, drop as references at the pointer. Capturing keeps Monaco’s own text drop and the file dropzone out of it.
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const positionAt = (event: DragEvent) => editorRef.current?.getTargetAtClientPoint(event.clientX, event.clientY)?.position
    const over = (event: DragEvent) => {
      if (!isReferenceDrag(event.dataTransfer)) {
        return
      }
      event.preventDefault(); event.stopPropagation()
      event.dataTransfer!.dropEffect = 'copy'
      const position = positionAt(event)
      if (position && editorRef.current) {
        editorRef.current.setPosition(position)
        if (!editorRef.current.hasTextFocus()) {
          editorRef.current.focus()
        }
      }
    }
    const drop = (event: DragEvent) => {
      if (!isReferenceDrag(event.dataTransfer)) {
        return
      }
      event.preventDefault(); event.stopPropagation()
      const reference = getDroppedReference(event.dataTransfer)
      if (reference) {
        insertIntoPrompt(reference, {
          x: event.clientX,
          y: event.clientY,
        })
      }
    }
    container.addEventListener('dragenter', over, true)
    container.addEventListener('dragover', over, true)
    container.addEventListener('drop', drop, true)
    return () => {
      container.removeEventListener('dragenter', over, true)
      container.removeEventListener('dragover', over, true)
      container.removeEventListener('drop', drop, true)
    }
  }, [])
  const updateDecorations = () => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = editor?.getModel()
    if (!editor || !monaco || !model || !decorationsRef.current) {
      return
    }
    const available = new Set(getIngredients().map(ingredient => ingredient.index))
    const hovered = editorStore.state.hoveredCollectionIndex
    const range = (from: number, to: number) => {
      const start = model.getPositionAt(from)
      const end = model.getPositionAt(to)
      return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column)
    }
    const decorations = findReferences(model.getValue()).flatMap(reference => {
      const valid = reference.index === 0 || available.has(reference.index)
      const className = reference.index === 0 ? css.canvasReference : (valid ? css.reference : css.missingReference)
      // References to the hovered collection tile light up.
      const token = {
        range: range(reference.start, reference.referenceEnd),
        options: {inlineClassName: reference.index === hovered ? `${className} ${css.hoveredReference}` : className},
      }
      if (reference.end === reference.referenceEnd) {
        return [token]
      }
      return [token, {
        range: range(reference.referenceEnd, reference.end),
        options: {inlineClassName: css.referenceDescription},
      }]
    })
    decorationsRef.current.set(decorations)
  }
  useEffect(updateDecorations, [ingredients, prompt, hoveredIndex])
  useEffect(() => () => {
    registerPromptInserter(undefined)
    cleanupRef.current?.()
  }, [])
  const handleMount = (editor: StandaloneEditor, monaco: MonacoApi) => {
    editorRef.current = editor
    // Keep Monaco authoritative during typing; synchronize only external state changes.
    editor.setValue(editorStore.state.prompt)
    const content = editor.onDidChangeModelContent(() => setPrompt(editor.getValue()))
    const unsubscribe = editorStore.subscribe(() => {
      const value = editorStore.state.prompt
      if (editor.getValue() !== value) {
        editor.setValue(value); updateDecorations()
      }
    })
    cleanupRef.current = () => {
      content.dispose(); unsubscribe()
    }
    monacoRef.current = monaco
    decorationsRef.current = editor.createDecorationsCollection()
    registerProviders(monaco)
    editor.addAction({
      id: 'layerpaint.generate',
      label: 'Generate',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        void generate()
      },
    })
    registerPromptInserter((text, client) => {
      const model = editor.getModel()
      const dropped = client ? editor.getTargetAtClientPoint(client.x, client.y)?.position : undefined
      const selection = dropped ? new monaco.Selection(dropped.lineNumber, dropped.column, dropped.lineNumber, dropped.column) : editor.getSelection()
      if (!selection || !model) {
        return
      }
      const before = model.getValueInRange({
        startLineNumber: selection.startLineNumber,
        startColumn: Math.max(1, selection.startColumn - 1),
        endLineNumber: selection.startLineNumber,
        endColumn: selection.startColumn,
      })
      const padded = before && !/\s/.test(before) ? ` ${text}` : text
      editor.executeEdits('layerpaint', [{
        range: selection,
        text: padded,
        forceMoveMarkers: true,
      }])
      editor.focus()
    })
    updateDecorations()
  }
  return <div className={css.container} data-testid='prompt-editor' ref={containerRef}>
    <Monacozen
      aria-label='Prompt'
      dark={dark}
      language='markdown'
      monaco={options}
      placeholder='Describe what should happen inside the frame…'
      onMount={handleMount}
    />
  </div>
}

export default PromptEditor
