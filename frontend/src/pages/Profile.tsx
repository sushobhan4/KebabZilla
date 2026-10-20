import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, CircleAlert, LocateFixed, MapPin, Plus, Save, Shield, Star, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { api, formatSavedAddress, type Account, type SavedAddress } from '../api'
import { useAuth, useRestaurant } from '../state'
import { Button, CenterDialog, Loading, PageTitle, PhoneInput, formatPhoneWithPrefix, isValidIndianMobile } from '../components'
import { EmailVerificationField } from '../components/EmailVerificationField'
import { validatePasswordComplexity } from './AuthPage'

const defaults = (): SavedAddress[] => [
  { id: 'home', label: 'Home', house_number: '', road: '', area: '', city: '', pincode: '', landmark: '', latitude: null, longitude: null, is_default: true },
]
function homeForProfile(role: string) {
  if (role === 'ADMIN') return '/admin'
  if (role === 'EMPLOYEE') return '/ops'
  if (role === 'DELIVERY') return '/delivery'
  return '/'
}
const amtalaMapCenter: google.maps.LatLngLiteral = { lat: 22.365278, lng: 88.269444 }
let googleLibrariesPromise: Promise<[google.maps.MapsLibrary, google.maps.GeocodingLibrary]> | null = null

function loadGoogleMaps(apiKey: string) {
  if (!googleLibrariesPromise) {
    setOptions({ key: apiKey, language: 'en', region: 'IN' })
    googleLibrariesPromise = Promise.all([importLibrary('maps'), importLibrary('geocoding')])
  }
  return googleLibrariesPromise
}

function AddressMap({ address, onSave, onClose }: { address: SavedAddress; onSave: (lat: number, lng: number, parts: Partial<SavedAddress>, distanceMeters: number | null) => void; onClose: () => void }) {
  const { restaurant } = useRestaurant()
  const mapElement = useRef<HTMLDivElement>(null)
  const choosePoint = useRef<(location: google.maps.LatLngLiteral) => void>(() => undefined)
  const [point, setPoint] = useState<google.maps.LatLngLiteral>(address.latitude != null && address.longitude != null ? { lat: address.latitude, lng: address.longitude } : amtalaMapCenter)
  const [parts, setParts] = useState<Partial<SavedAddress>>({ road: address.road, area: address.area, city: address.city, pincode: address.pincode || address.postal_code })
  const [lookup, setLookup] = useState('Pick the exact spot on the map.')
  const [looking, setLooking] = useState(false)
  const [mapLoading, setMapLoading] = useState(true)
  const [mapReady, setMapReady] = useState(false)
  const [locating, setLocating] = useState(false)
  const [selected, setSelected] = useState(address.latitude != null && address.longitude != null)

  const distanceInfo = useMemo(() => {
    if (restaurant?.latitude == null || restaurant?.longitude == null) {
      return { distKm: null, isWithinRadius: true, maxRadiusKm: restaurant?.delivery_radius_km ?? 15 }
    }
    const earthRadiusKm = 6371.0
    const dLat = ((point.lat - restaurant.latitude) * Math.PI) / 180
    const dLng = ((point.lng - restaurant.longitude) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((restaurant.latitude * Math.PI) / 180) *
        Math.cos((point.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const factor = restaurant.haversine_routing_factor || 1.3
    const distKm = Math.round(earthRadiusKm * c * factor * 10) / 10
    const maxRadiusKm = restaurant.delivery_radius_km ?? 15
    return {
      distKm,
      isWithinRadius: distKm <= maxRadiusKm,
      maxRadiusKm,
    }
  }, [point.lat, point.lng, restaurant])

  useEffect(() => {
    const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || restaurant?.google_maps_api_key || '').trim()
    if (!apiKey) {
      setMapLoading(false)
      setLookup('Add VITE_GOOGLE_MAPS_API_KEY to frontend/.env.local, then restart the frontend.')
      return
    }
    let disposed = false
    void loadGoogleMaps(apiKey).then(([mapsLibrary, geocodingLibrary]) => {
      const container = mapElement.current
      if (disposed || !container) return
      const savedPoint = address.latitude != null && address.longitude != null ? { lat: address.latitude, lng: address.longitude } : null
      const map = new mapsLibrary.Map(container, { center: savedPoint || amtalaMapCenter, zoom: savedPoint ? 15 : 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, clickableIcons: false, gestureHandling: 'greedy' })
      const geocoder = new geocodingLibrary.Geocoder()
      const marker = new google.maps.Marker({ map: savedPoint ? map : null, ...(savedPoint ? { position: savedPoint } : {}), draggable: true, title: 'Drag to the exact delivery location' })
      const reverseGeocode = (location: google.maps.LatLngLiteral) => {
        setPoint(location); setSelected(true); setLooking(true); setLookup('Finding the nearby road and area…')
        void geocoder.geocode({ location }).then(({ results }) => {
          const components = results[0]?.address_components || []
          const component = (...types: string[]) => components.find((item) => types.some((type) => item.types.includes(type)))?.long_name || ''
          const next = {
            road: component('route', 'street_address'),
            area: component('neighborhood', 'sublocality_level_1', 'sublocality', 'administrative_area_level_3'),
            city: component('locality', 'postal_town', 'administrative_area_level_2'),
            pincode: component('postal_code'),
          }
          if (disposed) return
          setParts((previous) => ({
            road: next.road || previous.road || address.road || '',
            area: next.area || previous.area || address.area || '',
            city: next.city || previous.city || address.city || '',
            pincode: next.pincode || previous.pincode || address.pincode || address.postal_code || '',
          }))
          setLookup([next.road, next.area, next.city, next.pincode].filter(Boolean).join(', ') || 'Location pinned. Add your flat number and landmark after saving the pin.')
        }).catch(() => {
          if (!disposed) setLookup('Pin saved. Road and area could not be found automatically; you can enter them below.')
        }).finally(() => { if (!disposed) setLooking(false) })
      }
      choosePoint.current = (location) => {
        if (disposed) return
        map.panTo(location); map.setZoom(17)
        marker.setPosition(location); marker.setMap(map)
        reverseGeocode(location)
      }
      map.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return
        choosePoint.current(event.latLng.toJSON())
      })
      marker.addListener('dragend', () => {
        const location = marker.getPosition()?.toJSON()
        if (location) reverseGeocode(location)
      })
      if (!disposed) { setMapLoading(false); setMapReady(true); setLookup(savedPoint ? 'Your saved pin is shown. Drag it to adjust the location.' : 'The map opens on Amtala. Click to place a pin at your exact location.') }
    }).catch((error: unknown) => {
      if (!disposed) {
        setMapLoading(false)
          setLookup(error instanceof Error ? `Google Maps could not load: ${error.message}` : 'Google Maps could not load. Check the API key and enabled APIs.')
      }
    })
    return () => { disposed = true; choosePoint.current = () => undefined }
  }, [address.latitude, address.longitude])

  return <div className="address-map-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="address-map-dialog" role="dialog" aria-modal="true" aria-labelledby="address-map-title">
    <div className="address-map-heading"><span><small>PIN YOUR DELIVERY LOCATION</small><h2 id="address-map-title">Set address on map</h2></span><button className="icon-button" type="button" aria-label="Close map" onClick={onClose}><X size={18} /></button></div>
    <div className="address-map-toolbar"><p className="address-map-help">The map opens on Amtala. Click to place a pin at your exact entrance, or use your current location.</p></div>
    <div className="address-map-wrap"><div className="address-map-canvas address-google-map" ref={mapElement} aria-label="Google Map for choosing your exact delivery location" /><button className="map-locate-control" type="button" aria-label="Find my location" title="Find my location" disabled={!mapReady || locating} onClick={() => {
      if (!navigator.geolocation) { setLookup('This browser does not support device location. You can still click the map or drag the pin.'); return }
      setLocating(true); setLookup('Finding your current location…')
      navigator.geolocation.getCurrentPosition((position) => { setLocating(false); choosePoint.current({ lat: position.coords.latitude, lng: position.coords.longitude }) }, (error) => {
        setLocating(false)
        setLookup(error.code === error.PERMISSION_DENIED ? 'Location access was blocked. Allow it in your browser settings, or choose a spot on the map.' : error.code === error.TIMEOUT ? 'Could not find your location in time. Try again or choose a spot on the map.' : 'Your location is unavailable. You can choose a spot on the map instead.')
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 })
    }}><LocateFixed size={19} /></button></div>
    <div className="address-map-status"><MapPin size={15} /><span>{mapLoading ? 'Loading Google Maps…' : locating ? 'Finding your current location…' : looking ? 'Finding nearby address details…' : lookup}</span></div>
    {selected && !distanceInfo.isWithinRadius && (
      <div className="address-map-warning-box">
        <CircleAlert size={16} />
        <span>This location is {distanceInfo.distKm} km away, which is outside our maximum delivery radius of {distanceInfo.maxRadiusKm} km. Please select a spot within {distanceInfo.maxRadiusKm} km.</span>
      </div>
    )}
    {selected && distanceInfo.isWithinRadius && distanceInfo.distKm !== null && (
      <div className="address-map-success-box">
        <Check size={14} />
        <span>Distance: {distanceInfo.distKm} km (Within our {distanceInfo.maxRadiusKm} km delivery limit)</span>
      </div>
    )}
    <div className="address-map-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="button" disabled={!selected || looking || mapLoading || !mapReady || !distanceInfo.isWithinRadius} onClick={() => { const meters = distanceInfo.distKm != null ? Math.round(distanceInfo.distKm * 1000) : null; onSave(point.lat, point.lng, parts, meters); onClose() }}><Check size={15} /> Use this pin</Button></div>
  </section></div>
}

export default function Profile() {
  const { account, loading, updateAccount } = useAuth()
  const [form, setForm] = useState({ name: account?.name || '', email: account?.email || '', phone: formatPhoneWithPrefix(account?.phone) })
  const [emailVerified, setEmailVerified] = useState(true)
  const [addresses, setAddresses] = useState<SavedAddress[]>(account?.addresses?.length ? account.addresses : defaults())
  const [activeAddress, setActiveAddress] = useState('home')
  const [mapAddress, setMapAddress] = useState<string | null>(null)
  const [editingAddress, setEditingAddress] = useState<string | null>(null)
  const [password, setPassword] = useState({ current_password: '', new_password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [addressToDelete, setAddressToDelete] = useState<SavedAddress | null>(null)
  const savedProfile = useRef('')
  const profileFormRef = useRef<HTMLFormElement>(null)
  const passwordFormRef = useRef<HTMLFormElement>(null)
  const isUpdatingPassword = Boolean(password.current_password || password.new_password || password.confirm)

  useEffect(() => {
    if (loading || !account) return
    const formattedPhone = formatPhoneWithPrefix(account.phone)
    setForm({ name: account.name, email: account.email, phone: formattedPhone })
    setEmailVerified(true)
    const saved = account.addresses?.length ? account.addresses : defaults()
    setAddresses(saved.some((item) => item.is_default) ? saved : saved.map((item, index) => ({ ...item, is_default: index === 0 })))
    savedProfile.current = JSON.stringify({ form: { name: account.name, email: account.email, phone: formattedPhone }, addresses: saved.some((item) => item.is_default) ? saved : saved.map((item, index) => ({ ...item, is_default: index === 0 })) })
    if (!saved.some((item) => item.id === activeAddress)) setActiveAddress(saved[0]?.id || 'home')
  }, [loading, account])

  const selectedAddress = useMemo(() => addresses.find((item) => item.id === activeAddress) || addresses[0], [addresses, activeAddress])
  const profileChanged = JSON.stringify({ form, addresses }) !== savedProfile.current
  const emailNeedsVerification = form.email.trim().toLowerCase() !== (account?.email || '').toLowerCase() && !emailVerified

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('')
    if (!isValidIndianMobile(form.phone)) {
      setError('Please enter a valid 10-digit mobile number.')
      return
    }
    if (emailNeedsVerification) {
      setError('Please verify your new email address before saving.')
      return
    }
    const savedAddressId = activeAddress
    const incomplete = addresses.find((item) => (item.latitude != null || item.longitude != null) && (item.latitude == null || item.longitude == null || !item.house_number?.trim() || !item.road?.trim() || !item.area?.trim() || !item.city?.trim() || !(item.pincode || item.postal_code)?.trim()))
    if (incomplete) {
      setActiveAddress(incomplete.id)
      setError(`Complete the house or flat, road, area, city, and PIN code for ${incomplete.label}. Landmark is optional.`)
      return
    }
    setBusy(true)
    const normalized = addresses.map(({ postal_code, ...item }) => ({ ...item, pincode: item.pincode || postal_code || '' }))
    try {
      const updated = await api<Account>('/auth/profile', { method: 'PATCH', body: JSON.stringify({ ...form, phone: form.phone || null, addresses: normalized }) })
      const updatedPhone = formatPhoneWithPrefix(updated.phone)
      updateAccount(updated); setForm({ name: updated.name, email: updated.email, phone: updatedPhone }); setAddresses(updated.addresses)
      savedProfile.current = JSON.stringify({ form: { name: updated.name, email: updated.email, phone: updatedPhone }, addresses: updated.addresses })
      if (updated.addresses.some((item) => item.id === savedAddressId)) setActiveAddress(savedAddressId)
      setEditingAddress(null)
      setNotice('Profile and saved addresses updated.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save your profile.') }
    finally { setBusy(false) }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.new_password !== password.confirm) { setError('The new passwords do not match.'); return }
    const pwdError = validatePasswordComplexity(password.new_password)
    if (pwdError) { setError(pwdError); return }
    setBusy(true); setError(''); setNotice('')
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password: password.current_password, new_password: password.new_password }) })
      setPassword({ current_password: '', new_password: '', confirm: '' }); setNotice('Password changed.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not change your password.') }
    finally { setBusy(false) }
  }

  function editAddress(id: string, change: Partial<SavedAddress>) {
    setAddresses((items) => items.map((item) => item.id === id ? { ...item, ...change } : item))
  }
  function setDefaultAddress(id: string) {
    setAddresses((items) => items.map((item) => ({ ...item, is_default: item.id === id })))
  }
  function addAddress() {
    const id = globalThis.crypto?.randomUUID?.() || 'address-' + Date.now()
    setAddresses((items) => [...items, { id, label: 'New address', house_number: '', road: '', area: '', city: '', pincode: '', landmark: '', latitude: null, longitude: null, is_default: false }]); setActiveAddress(id)
  }

  function confirmDeleteAddress(addressId: string) {
    let remaining = addresses.filter((item) => item.id !== addressId)
    if (!remaining.some((item) => item.is_default) && remaining.length) {
      remaining = remaining.map((item, index) => ({ ...item, is_default: index === 0 }))
    }
    setAddresses(remaining)
    if (activeAddress === addressId) {
      setActiveAddress(remaining[0]?.id || 'home')
    }
    setAddressToDelete(null)
  }

  if (loading) return <main className="customer-page profile-page"><Loading label="Loading your profile…" /></main>
  return <main className="customer-page profile-page">
    <PageTitle eyebrow={`${account?.role || 'YOUR'} KEBABZILLA ACCOUNT`} title="Edit profile" description="Update your personal details and password." action={<Link className="button button-secondary" to={account && account.role !== 'USER' ? homeForProfile(account.role) : '/'}><ArrowLeft size={15} /> Back</Link>} />
    <form ref={profileFormRef} className="profile-card" onSubmit={(event) => void saveProfile(event)}>
      <div className="profile-card-heading"><h2>Personal details</h2></div>
      <div className="profile-form-grid" style={{ alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label className="field-label" style={{ marginBottom: 0 }}><span>Name <sup className="field-required">*</sup></span><input required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className="field-label" style={{ marginBottom: 0 }}><span>Mobile number <sup className="field-required">*</sup></span><PhoneInput required value={form.phone} onChange={(val) => setForm({ ...form, phone: val })} /></label>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="field-label" style={{ display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
            <span style={{ marginBottom: '6px' }}>Email address <sup className="field-required">*</sup></span>
            <EmailVerificationField
              email={form.email}
              onChangeEmail={(val) => setForm((prev) => ({ ...prev, email: val }))}
              isVerified={emailVerified}
              onVerifiedChange={setEmailVerified}
              purpose="UPDATE_PROFILE"
              excludeId={account?.id}
              initialVerifiedEmail={account?.email}
              disabled={busy}
            />
          </div>
        </div>
      </div>
      <div className="profile-card-heading profile-address-heading"><span><h2>Saved addresses</h2><small>Select a tab to edit that address. Home is included by default.</small></span></div>
      <div className="address-tabs" role="tablist" aria-label="Saved addresses">
        {addresses.map((item) => {
          const isHome = item.id === 'home' || item.label.trim().toLowerCase() === 'home'
          return (
            <div
              key={item.id}
              role="tab"
              aria-selected={selectedAddress?.id === item.id}
              className={`address-tab ${selectedAddress?.id === item.id ? 'active' : ''}`}
              onClick={() => setActiveAddress(item.id)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setActiveAddress(item.id)
                }
              }}
            >
              <span>{item.label}</span>
              {item.is_default && <Star size={12} fill="currentColor" />}
              {!isHome && (
                <button
                  type="button"
                  className="address-tab-delete-btn"
                  aria-label={`Delete ${item.label}`}
                  title={`Delete ${item.label}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setAddressToDelete(item)
                  }}
                >
                  <X size={12} strokeWidth={2.4} />
                </button>
              )}
            </div>
          )
        })}
        <button type="button" className="address-add-button" onClick={addAddress} title="Add address" aria-label="Add address"><Plus size={16} /></button>
      </div>
      {selectedAddress && <article className="saved-address-card" key={selectedAddress.id}>
        <div className="saved-address-title"><label className="field-label"><span>Address name <sup className="field-required">*</sup></span><input required maxLength={40} value={selectedAddress.label} onChange={(event) => editAddress(selectedAddress.id, { label: event.target.value })} /></label><div className="address-card-actions">{!selectedAddress.is_default && <button className="text-button address-default-button" type="button" onClick={() => setDefaultAddress(selectedAddress.id)}><Star size={14} /> Set as default</button>}{selectedAddress.id !== 'home' && selectedAddress.label.trim().toLowerCase() !== 'home' && <button className="icon-button danger-icon" type="button" aria-label="Delete address" title="Delete address" onClick={() => setAddressToDelete(selectedAddress)}><Trash2 size={16} /></button>}</div></div>
        {selectedAddress.latitude != null && selectedAddress.longitude != null ? <>
        <div className="saved-address-location"><div><span className="saved-address-location-label">Saved location</span><strong>{formatSavedAddress(selectedAddress) || 'Pinned location'}</strong></div><div className="address-location-actions"><Button type="button" variant="secondary" onClick={() => setEditingAddress(editingAddress === selectedAddress.id ? null : selectedAddress.id)}>{editingAddress === selectedAddress.id ? 'Done' : 'Edit'}</Button>{editingAddress === selectedAddress.id && <Button type="button" variant="secondary" onClick={() => setMapAddress(selectedAddress.id)}><MapPin size={15} /> Edit pin</Button>}</div></div>
        <div className={`address-edit-panel ${editingAddress === selectedAddress.id ? 'address-edit-panel-open' : ''}`} aria-hidden={editingAddress !== selectedAddress.id} inert={editingAddress !== selectedAddress.id}>
        <div className="address-edit-panel-inner">
        <div className="address-details-step"><h3>Address details</h3><p>The street and area came from your pin. Add your flat or house number and a landmark, then save the profile and address together.</p></div>
        <div className="profile-form-grid address-detail-grid">
          <label className="field-label"><span>House / flat / unit <sup className="field-required">*</sup></span><input required maxLength={120} placeholder="Flat 4B, House 12" value={selectedAddress.house_number || ''} onChange={(event) => editAddress(selectedAddress.id, { house_number: event.target.value })} /></label>
          <label className="field-label"><span>Road / street <sup className="field-required">*</sup></span><input required maxLength={160} placeholder="Filled from map pin" value={selectedAddress.road || ''} onChange={(event) => editAddress(selectedAddress.id, { road: event.target.value })} /></label>
          <label className="field-label"><span>Area <sup className="field-required">*</sup></span><input required maxLength={160} placeholder="Filled from map pin" value={selectedAddress.area || ''} onChange={(event) => editAddress(selectedAddress.id, { area: event.target.value })} /></label>
          <label className="field-label"><span>City <sup className="field-required">*</sup></span><input required maxLength={120} placeholder="City" value={selectedAddress.city || ''} onChange={(event) => editAddress(selectedAddress.id, { city: event.target.value })} /></label>
          <label className="field-label"><span>PIN code <sup className="field-required">*</sup></span><input required maxLength={20} placeholder="Postal code" value={selectedAddress.pincode || selectedAddress.postal_code || ''} onChange={(event) => editAddress(selectedAddress.id, { pincode: event.target.value, postal_code: undefined })} /></label>
          <label className="field-label"><span>Landmark (optional)</span><input maxLength={200} placeholder="Near the park entrance" value={selectedAddress.landmark || ''} onChange={(event) => editAddress(selectedAddress.id, { landmark: event.target.value })} /></label>
        </div>
        </div>
        </div>
        </> : <div className="address-pin-first"><span><MapPin size={18} /></span><div><strong>Set the exact location first</strong><small>House or flat, road, area, city, PIN code, and landmark fields appear after you save a map pin.</small></div><Button type="button" onClick={() => setMapAddress(selectedAddress.id)}><MapPin size={15} /> Set location on map</Button></div>}
      </article>}
    </form>
    <form ref={passwordFormRef} className="profile-card password-card" onSubmit={(event) => void changePassword(event)}>
      <div className="profile-card-heading"><h2>Change password</h2><span>At least 8 characters (a-z, A-Z, 0-9, special).</span></div>
      <div className="profile-password-form-grid">
        <label className="field-label password-full-row"><span>Current password <sup className="field-required">*</sup></span><input required type="password" autoComplete="current-password" value={password.current_password} onChange={(event) => setPassword({ ...password, current_password: event.target.value })} /></label>
        <div className="password-split-row">
          <label className="field-label"><span>New password <sup className="field-required">*</sup></span><input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={password.new_password} onChange={(event) => setPassword({ ...password, new_password: event.target.value })} /></label>
          <label className="field-label"><span>Confirm new password <sup className="field-required">*</sup></span><input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={password.confirm} onChange={(event) => setPassword({ ...password, confirm: event.target.value })} /></label>
        </div>
      </div>
    </form>
    {account && ['ADMIN', 'EMPLOYEE', 'DELIVERY'].includes(account.role) && (
      <div className="profile-security-banner">
        <div>
          <h3>Account security & login activity</h3>
          <p>Review devices logged into your account and manage active sessions.</p>
        </div>
        <Link to="/security" className="button button-secondary">
          <Shield size={15} /> Security
        </Link>
      </div>
    )}
    <div className="profile-sticky-bottom-bar">
      <div className="profile-sticky-inner">
        {isUpdatingPassword ? (
          <Button
            type="button"
            className="profile-save-button"
            disabled={busy}
            onClick={() => passwordFormRef.current?.requestSubmit()}
          >
            <Check size={18} /> {busy ? 'Updating…' : 'Update password'}
          </Button>
        ) : (
          <Button
            type="button"
            className="profile-save-button"
            disabled={busy || emailNeedsVerification || !profileChanged}
            onClick={() => profileFormRef.current?.requestSubmit()}
          >
            <Save size={18} /> {busy ? 'Saving…' : 'Save profile & address'}
          </Button>
        )}
      </div>
    </div>
    {mapAddress && addresses.find((item) => item.id === mapAddress) && <AddressMap address={addresses.find((item) => item.id === mapAddress)!} onClose={() => setMapAddress(null)} onSave={(latitude, longitude, parts, distanceMeters) => { editAddress(mapAddress, { ...parts, latitude, longitude, distance_meters: distanceMeters }); setEditingAddress(mapAddress) }} />}
    {addressToDelete && (
      <CenterDialog
        isOpen={Boolean(addressToDelete)}
        onClose={() => setAddressToDelete(null)}
        tone="danger"
        eyebrow="DELETE ADDRESS"
        title={`Delete ${addressToDelete.label}?`}
        description={`Are you sure you want to delete ${addressToDelete.label}? This action cannot be undone.${formatSavedAddress(addressToDelete) ? ` (${formatSavedAddress(addressToDelete)})` : ''}`}
        primaryAction={{
          label: "Delete address",
          variant: "danger",
          onClick: () => confirmDeleteAddress(addressToDelete.id),
        }}
        secondaryAction={{
          label: "Keep address",
          variant: "secondary",
          onClick: () => setAddressToDelete(null),
        }}
      />
    )}
    {error && (
      <CenterDialog
        isOpen={Boolean(error)}
        onClose={() => setError('')}
        tone="danger"
        eyebrow={isUpdatingPassword ? "PASSWORD ERROR" : "PROFILE ERROR"}
        title={isUpdatingPassword ? "Password update error" : "Could not save profile"}
        description={error}
        primaryAction={{
          label: "Dismiss",
          variant: "primary",
          onClick: () => setError(''),
        }}
      />
    )}
    {notice && (
      <CenterDialog
        isOpen={Boolean(notice)}
        onClose={() => setNotice('')}
        tone="success"
        eyebrow="CHANGES SAVED"
        title="Account updated"
        description={notice}
        primaryAction={{
          label: "Done",
          variant: "primary",
          onClick: () => setNotice(''),
        }}
      />
    )}
  </main>
}
