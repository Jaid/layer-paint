import 'react'

declare module 'react' {
  interface ButtonHTMLAttributes<T> {
    /** ID of a popover that opens while the button is hovered or focused (HTML interest invokers) */
    interestfor?: string
  }
}
