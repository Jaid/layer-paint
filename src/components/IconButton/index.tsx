import type {LucideIcon} from 'lucide-react'
import type {ComponentProps} from 'react'

import clsx from 'clsx'

import css from './style.module.sass'

type Props = ComponentProps<'button'> & {
  active?: boolean
  icon: LucideIcon
  label?: string
  size?: number
}

/** compact button with an icon and optional text label; the title doubles as accessible name */
const IconButton = ({active, className, icon: Icon, label, size = 16, type = 'button', ...props}: Props) => <button
  className={clsx(css.button, label && css.withLabel, active && css.active, className)}
  aria-label={props['aria-label'] ?? props.title}
  aria-pressed={active}
  type={type}
  {...props}
>
  <Icon absoluteStrokeWidth aria-hidden size={size} strokeWidth={1.6} />
  {label && <span>{label}</span>}
</button>

export default IconButton
