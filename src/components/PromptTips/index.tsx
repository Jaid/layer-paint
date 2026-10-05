import {editorStore, projectStore} from '#src/lib/state.ts'
import {useStore} from '#src/lib/store/index.ts'

import css from './style.module.sass'

const examples = [
  'Please put ![1] onto the head of ![0]',
  'Please put a ring on the finger of ![0]',
  'Please restyle this to be a beautiful artistic oil painting',
]
/** short onboarding shown in the empty prompt editor */
const PromptTips = () => {
  const empty = useStore(editorStore, state => state.prompt.trim() === '')
  const hasLayers = useStore(projectStore, state => state.layers.length > 0)
  if (!empty) {
    return null
  }
  return <aside className={css.tips} data-testid='prompt-tips'>
    <ol className={css.steps}>
      <li className={hasLayers ? css.done : undefined}><strong>Drop an image onto the canvas</strong> or start from scratch – the first generation fills the frame.</li>
      <li><strong>Move and resize the frame</strong> over the part you want to change. Leave some padding so the model sees style, lighting and proportions.</li>
      <li><strong>Drop reference images here</strong> and mention them as <code>![1]</code>, <code>![2]</code>, … <code>![0]</code> is everything inside the frame.</li>
      <li><strong>Generate</strong> with <kbd>Ctrl</kbd> <kbd>Enter</kbd>. Each result becomes a layer with its own feathering and area.</li>
    </ol>
    <div className={css.examples}>
      {examples.map(example => <button key={example} className={css.example} type='button' onClick={() => editorStore.set({prompt: example})}>{example}</button>)}
    </div>
  </aside>
}

export default PromptTips
