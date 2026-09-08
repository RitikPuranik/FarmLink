"use client";

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  ShoppingBag,
  User,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react'

import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { LogoMark } from '@/components/Logo'

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  const [lastScrollY, setLastScrollY] = useState(0)

  // =========================================================
  // SMART NAVBAR HIDE / SHOW
  // =========================================================

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY

      setScrolled(currentScrollY > 30)

      // Never hide navbar while mobile menu is open
      if (mobileMenuOpen) {
        setIsVisible(true)
        return
      }

      if (currentScrollY < 40) {
        setIsVisible(true)
      } else if (
        currentScrollY > lastScrollY &&
        currentScrollY > 80
      ) {
        // Scrolling down
        setIsVisible(false)
      } else if (currentScrollY < lastScrollY) {
        // Scrolling up
        setIsVisible(true)
      }

      setLastScrollY(currentScrollY)
    }

    window.addEventListener('scroll', handleScroll, {
      passive: true,
    })

    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [lastScrollY, mobileMenuOpen])

  // =========================================================
  // CLOSE MOBILE MENU WITH ESC
  // =========================================================

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false)
      }
    }

    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  // =========================================================
  // CLOSE MOBILE MENU ON DESKTOP
  // =========================================================

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileMenuOpen(false)
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  // =========================================================
  // FEATURES NAVIGATION
  // =========================================================

  const goToFeatures = () => {
    setMobileMenuOpen(false)

    window.dispatchEvent(new Event('growth-final'))
  }

  // =========================================================
  // MOBILE NAV ITEM STYLE
  // =========================================================

  const mobileLinkClass =
    'flex items-center justify-between rounded-xl px-4 py-3.5 text-sm font-bold uppercase tracking-wider text-white/75 transition-all duration-200 hover:bg-white/10 hover:text-[#e3b23c] active:scale-[0.98]'

  return (
    <div
      className="
        min-h-screen
        overflow-x-hidden
        bg-[#15150f]
        font-['Plus_Jakarta_Sans',sans-serif]
        text-[#f8f4e9]
        antialiased
        selection:bg-[#e3b23c]
        selection:text-[#201f12]
      "
    >
      {/* =====================================================
          CUSTOM TYPOGRAPHY
      ===================================================== */}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@700&family=Yellowtail&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

        :root {
          --sticker-stroke: 5px;
          --script-stroke: 3px;
        }

        @media (min-width: 640px) {
          :root {
            --sticker-stroke: 8px;
            --script-stroke: 5px;
          }
        }

        @media (min-width: 1024px) {
          :root {
            --sticker-stroke: 12px;
            --script-stroke: 8px;
          }
        }

        .brand-sticker {
          font-family: 'Fredoka', cursive, sans-serif;
          font-weight: 700;
          color: #1c1b12;
          -webkit-text-stroke: var(--sticker-stroke) #f8f4e9;
          paint-order: stroke fill;
          stroke-linejoin: round;
          stroke-linecap: round;
          letter-spacing: -0.02em;
          filter:
            drop-shadow(0px 5px 12px rgba(0, 0, 0, 0.45));
        }

        .brand-script-yellow {
          font-family: 'Yellowtail', cursive;
          color: #e3b23c;
          -webkit-text-stroke: var(--script-stroke) #f8f4e9;
          paint-order: stroke fill;
          stroke-linejoin: round;
          stroke-linecap: round;
          filter:
            drop-shadow(0px 4px 10px rgba(0, 0, 0, 0.35));
        }
      `}</style>

      {/* =====================================================
          NAVBAR
      ===================================================== */}

      <header
        className={`
          fixed
          inset-x-0
          top-0
          z-50
          transition-all
          duration-500
          ease-in-out

          ${isVisible ? 'translate-y-0' : '-translate-y-full'}

          ${
            scrolled
              ? `
                border-b
                border-white/10
                bg-[#15150f]/80
                py-3
                shadow-xl
                backdrop-blur-xl
              `
              : `
                bg-gradient-to-b
                from-black/60
                via-black/20
                to-transparent
                py-4
              `
          }
        `}
      >
        <div
          className="
            mx-auto
            flex
            max-w-7xl
            items-center
            justify-between
            px-4
            sm:px-8
            lg:px-12
          "
        >
          {/* =================================================
              LOGO
          ================================================= */}

          <Link
            href="/"
            onClick={() => setMobileMenuOpen(false)}
            className="
              group
              flex
              shrink-0
              items-center
              gap-2.5
              sm:gap-3
            "
          >
            <div
              className="
                flex
                h-9
                w-9
                shrink-0
                items-center
                justify-center
                rounded-full
                border
                border-white/20
                bg-white/10
                backdrop-blur-md
                transition-all
                duration-300
                group-hover:border-[#e3b23c]
                group-hover:bg-white/15
              "
            >
              <LogoMark
                className="
                  h-5
                  w-5
                  text-[#e3b23c]
                "
              />
            </div>

            <span
              className="
                text-lg
                font-black
                tracking-tight
                text-white
                transition-colors
                duration-300
                group-hover:text-[#e3b23c]
                sm:text-xl
              "
            >
              Anndata
            </span>
          </Link>

          {/* =================================================
              DESKTOP NAVIGATION + TAGLINE
          ================================================= */}

          <div
            className="
              hidden
              flex-1
              items-center
              justify-center
              gap-8
              md:flex
              lg:gap-10
            "
          >
            {/* NAVIGATION */}

            <nav
              className="
                flex
                items-center
                gap-5
                text-[11px]
                font-bold
                uppercase
                tracking-[0.16em]
                text-white/70
                lg:gap-7
                lg:text-xs
              "
            >
              <a
                href="#hero"
                className="
                  transition-colors
                  duration-300
                  hover:text-white
                "
              >
                Home
              </a>

              <button
                type="button"
                onClick={goToFeatures}
                className="
                  cursor-pointer
                  uppercase
                  transition-colors
                  duration-300
                  hover:text-white
                "
              >
                Features
              </button>

              <a
                href="#about"
                className="
                  transition-colors
                  duration-300
                  hover:text-white
                "
              >
                Services
              </a>

              <a
                href="#features"
                className="
                  transition-colors
                  duration-300
                  hover:text-white
                "
              >
                Ecosystem
              </a>
            </nav>

            {/* TAGLINE */}

            <div
              className="
                hidden
                items-center
                gap-2
                border-l
                border-white/15
                pl-7
                xl:flex
              "
            >
              <span
                className="
                  h-1.5
                  w-1.5
                  rounded-full
                  bg-[#e3b23c]
                "
              />

              <span
                className="
                  whitespace-nowrap
                  text-[10px]
                  font-semibold
                  tracking-wide
                  text-white/50
                  lg:text-[11px]
                "
              >
                Rooted in Farming. Built for the Future.
              </span>
            </div>
          </div>

          {/* =================================================
              RIGHT SIDE
          ================================================= */}

          <div
            className="
              flex
              shrink-0
              items-center
              gap-2
              sm:gap-3
            "
          >
            {/* LANGUAGE */}

            <div className="shrink-0">
              <LanguageSwitcher
                className="
                  [&>button]:border-white/15
                  [&>button]:bg-white/10
                  [&>button]:text-white/80

                  hover:[&>button]:border-[#e3b23c]/50
                  hover:[&>button]:text-[#e3b23c]

                  [&>div[role=menu]]:border-white/10
                  [&>div[role=menu]]:bg-[#1c1b12]/95
                  [&>div[role=menu]]:text-white/80

                  [&_p]:text-white/40

                  [&_button[role=menuitemradio]]:text-white/70
                  hover:[&_button[role=menuitemradio]]:bg-white/10
                  hover:[&_button[role=menuitemradio]]:text-white

                  [&_div[aria-disabled]]:text-white/30
                  [&_div.border-t]:border-white/10
                "
              />
            </div>

            {/* DESKTOP LOGIN */}

            <Link
              href="/login"
              className="
                group
                hidden
                items-center
                gap-2
                rounded-full
                border
                border-white/15
                bg-white/10
                px-5
                py-2.5
                text-xs
                font-extrabold
                uppercase
                tracking-wider
                text-white
                backdrop-blur-md
                transition-all
                duration-300
                hover:border-[#e3b23c]
                hover:bg-[#e3b23c]
                hover:text-[#201f12]
                active:scale-95
                sm:text-sm
                md:inline-flex
              "
            >
              <User className="h-4 w-4" />

              <span>
                Login / Register
              </span>
            </Link>

            {/* MOBILE MENU BUTTON */}

            <button
              type="button"
              onClick={() =>
                setMobileMenuOpen(!mobileMenuOpen)
              }
              className="
                flex
                h-10
                w-10
                shrink-0
                items-center
                justify-center
                rounded-full
                border
                border-white/15
                bg-white/10
                text-white/80
                backdrop-blur-md
                transition-all
                duration-300
                hover:border-[#e3b23c]/50
                hover:text-white
                active:scale-95
                md:hidden
              "
              aria-label={
                mobileMenuOpen
                  ? 'Close Navigation'
                  : 'Open Navigation'
              }
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        {/* =====================================================
            MOBILE MENU
        ===================================================== */}

        <div
          className={`
            overflow-hidden
            px-4
            transition-all
            duration-300
            md:hidden

            ${
              mobileMenuOpen
                ? 'max-h-[520px] pt-3 opacity-100'
                : 'max-h-0 pt-0 opacity-0'
            }
          `}
        >
          <div
            className="
              mx-auto
              max-w-7xl
              rounded-2xl
              border
              border-white/10
              bg-[#15150f]/95
              p-3
              shadow-2xl
              shadow-black/50
              backdrop-blur-2xl
            "
          >
            {/* MOBILE TAGLINE */}

            <div
              className="
                mb-2
                rounded-xl
                border
                border-white/10
                bg-white/[0.04]
                px-4
                py-3
                text-center
              "
            >
              <p
                className="
                  text-[10px]
                  font-semibold
                  tracking-wide
                  text-[#e3b23c]
                "
              >
                Rooted in Farming. Built for the Future.
              </p>
            </div>

            {/* HOME */}

            <a
              href="#hero"
              onClick={() =>
                setMobileMenuOpen(false)
              }
              className={mobileLinkClass}
            >
              <span>Home</span>

              <ChevronRight
                className="h-4 w-4 text-white/30"
              />
            </a>

            {/* FEATURES */}

            <button
              type="button"
              onClick={goToFeatures}
              className={`${mobileLinkClass} w-full text-left`}
            >
              <span>Features</span>

              <ChevronRight
                className="h-4 w-4 text-white/30"
              />
            </button>

            {/* SERVICES */}

            <a
              href="#about"
              onClick={() =>
                setMobileMenuOpen(false)
              }
              className={mobileLinkClass}
            >
              <span>Services</span>

              <ChevronRight
                className="h-4 w-4 text-white/30"
              />
            </a>

            {/* ECOSYSTEM */}

            <a
              href="#features"
              onClick={() =>
                setMobileMenuOpen(false)
              }
              className={mobileLinkClass}
            >
              <span>Ecosystem</span>

              <ChevronRight
                className="h-4 w-4 text-white/30"
              />
            </a>

            <div
              className="
                my-2
                border-t
                border-white/10
              "
            />

            {/* LOGIN */}

            <Link
              href="/login"
              onClick={() =>
                setMobileMenuOpen(false)
              }
              className="
                flex
                items-center
                justify-between
                rounded-xl
                bg-[#e3b23c]
                px-4
                py-3.5
                text-sm
                font-black
                uppercase
                tracking-wider
                text-[#201f12]
                transition-all
                duration-200
                hover:bg-[#eec766]
                active:scale-[0.98]
              "
            >
              <span className="flex items-center gap-2.5">
                <User className="h-4 w-4" />

                Login / Register
              </span>

              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* =====================================================
          HERO SECTION
      ===================================================== */}

      <section
        id="hero"
        className="
          relative
          flex
          min-h-[100dvh]
          items-center
          justify-center
          overflow-hidden
          px-4
          pb-16
          pt-28
          sm:px-8
          md:px-16
          md:pt-32
        "
      >
        {/* =================================================
            BACKGROUND IMAGE
        ================================================= */}

        <div className="absolute inset-0 z-0">
          <img
            src="https://images.unsplash.com/photo-1623958045855-0b7a60cfb9eb?q=80&w=1600&auto=format&fit=crop"
            alt="Farmers harvesting crop in field"
            className="
              h-full
              w-full
              scale-105
              object-cover
              object-center
            "
          />

          {/* DARK CINEMATIC OVERLAY */}

          <div
            className="
              absolute
              inset-0
              bg-gradient-to-r
              from-black/85
              via-black/55
              to-black/15
            "
          />

          <div
            className="
              absolute
              inset-0
              bg-gradient-to-t
              from-black/45
              via-transparent
              to-black/20
            "
          />
        </div>

        {/* =================================================
            CENTERED HERO CONTENT
        ================================================= */}

        <div
          className="
            relative
            z-10
            mx-auto
            flex
            w-full
            max-w-6xl
            flex-col
            items-center
            justify-center
            text-center
          "
        >
          {/* HERO TAG */}

          <div
            className="
              mb-5
              inline-flex
              items-center
              gap-2
              rounded-full
              border
              border-white/15
              bg-black/25
              px-4
              py-2
              backdrop-blur-md
              sm:mb-7
            "
          >
            <span
              className="
                h-2
                w-2
                rounded-full
                bg-[#e3b23c]
              "
            />

            <span
              className="
                text-[9px]
                font-bold
                uppercase
                tracking-[0.18em]
                text-white/75
                sm:text-[11px]
              "
            >
              Agriculture • Technology • Opportunity
            </span>
          </div>

          {/* =================================================
              MAIN HERO TITLE
          ================================================= */}

          <div
            className="
              flex
              w-full
              flex-col
              items-center
              justify-center
              leading-none
              select-none
            "
          >
            {/* EVERY MEAL */}

            <h1
              className="
                brand-sticker
                py-1
                text-5xl
                leading-[1.1]
                sm:text-7xl
                md:text-8xl
                lg:text-[96px]
              "
            >
              Every Meal
            </h1>

            {/* BEGINS WITH + A FARMER */}

            <div
              className="
                -mt-1
                flex
                flex-wrap
                items-center
                justify-center
                gap-2
                py-1
                sm:-mt-4
                sm:gap-4
                md:-mt-6
                lg:-mt-8
              "
            >
              <span
                className="
                  brand-script-yellow
                  -rotate-6
                  transform
                  pr-1
                  text-4xl
                  sm:text-6xl
                  md:text-7xl
                  lg:text-8xl
                "
              >
                begins with
              </span>

              <h2
                className="
                  brand-sticker
                  text-5xl
                  leading-[1.1]
                  sm:text-7xl
                  md:text-8xl
                  lg:text-[96px]
                "
              >
                a Farmer.
              </h2>
            </div>
          </div>

          {/* =================================================
              DESCRIPTION
          ================================================= */}

          <p
            className="
              mt-6
              max-w-2xl
              px-4
              text-center
              text-sm
              font-light
              leading-relaxed
              text-white/75
              sm:mt-8
              sm:px-0
              sm:text-base
              md:text-lg
            "
          >
            Empowering agricultural communities with direct
            produce markets, real-time mandi prices, modern
            equipment rentals, and AI-driven crop intelligence.
          </p>

          {/* =================================================
              CTA BUTTONS
          ================================================= */}

          <div
            className="
              mt-7
              flex
              w-full
              flex-col
              items-center
              justify-center
              gap-3
              px-4
              sm:mt-9
              sm:w-auto
              sm:flex-row
              sm:px-0
              sm:gap-4
            "
          >
            {/* MARKETPLACE */}

            <Link
              href="/login"
              className="
                flex
                w-full
                items-center
                justify-center
                gap-2
                rounded-xl
                border
                border-white/20
                bg-white/10
                px-6
                py-3.5
                text-xs
                font-bold
                uppercase
                tracking-wider
                text-white
                shadow-xl
                backdrop-blur-md
                transition-all
                duration-300
                hover:bg-white/20
                hover:border-white/30
                active:scale-[0.98]
                sm:w-auto
                sm:px-8
                sm:py-4
              "
            >
              <ShoppingBag
                className="
                  h-4
                  w-4
                  sm:h-5
                  sm:w-5
                "
              />

              Explore Marketplace
            </Link>

            {/* GET STARTED */}

            <Link
              href="/login"
              className="
                flex
                w-full
                items-center
                justify-center
                gap-2
                rounded-xl
                bg-[#e3b23c]
                px-6
                py-3.5
                text-xs
                font-black
                uppercase
                tracking-wider
                text-[#201f12]
                shadow-xl
                transition-all
                duration-300
                hover:bg-[#eec766]
                active:scale-[0.98]
                sm:w-auto
                sm:px-8
                sm:py-4
              "
            >
              Get Started Now

              <ArrowRight
                className="
                  h-4
                  w-4
                  sm:h-5
                  sm:w-5
                "
              />
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

