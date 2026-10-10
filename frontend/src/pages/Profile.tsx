import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, LocateFixed, MapPin, Plus, Save, Star, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { api, formatSavedAddress, type Account, type SavedAddress } from '../api'
import { useAuth } from '../state'
import { Button, Loading, Notice, PageTitle } from '../components'

const defaults = (): SavedAddress[] => [
  { id: 'home', label: 'Home', house_number: '', road: '', area: '', city: '', pincode: '', landmark: '', latitude: null, longitude: null, is_default: true },
  { id: 'work', label: 'Work', house_number: '', road: '', area: '', city: '', pincode: '', landmark: '', latitude: null, longitude: null, is_default: false },
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

function AddressMap({ address, onSave, onClose }: { address: SavedAddress; onSave: (lat: number, lng: number, parts: Partial<SavedAddress>) => void; onClose: () => void }) {
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

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
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
    <div className="address-map-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="button" disabled={!selected || looking || mapLoading || !mapReady} onClick={() => { onSave(point.lat, point.lng, parts); onClose() }}><Check size={15} /> Use this pin</Button></div>
  </section></div>
}

export default function Profile() {
  const { account, loading, updateAccount } = useAuth()
  const isCustomer = account?.role === 'USER'
  const [form, setForm] = useState({ name: account?.name || '', email: account?.email || '', phone: account?.phone || '' })
  const [addresses, setAddresses] = useState<SavedAddress[]>(account?.addresses?.length ? account.addresses : defaults())
  const [activeAddress, setActiveAddress] = useState('home')
  const [mapAddress, setMapAddress] = useState<string | null>(null)
  const [editingAddress, setEditingAddress] = useState<string | null>(null)
  const [password, setPassword] = useState({ current_password: '', new_password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const savedProfile = useRef('')

  useEffect(() => {
    if (loading || !account) return
    setForm({ name: account.name, email: account.email, phone: account.phone || '' })
    const saved = account.addresses?.length ? account.addresses : defaults()
    setAddresses(saved.some((item) => item.is_default) ? saved : saved.map((item, index) => ({ ...item, is_default: index === 0 })))
    savedProfile.current = JSON.stringify({ form: { name: account.name, email: account.email, phone: account.phone || '' }, addresses: saved.some((item) => item.is_default) ? saved : saved.map((item, index) => ({ ...item, is_default: index === 0 })) })
    if (!saved.some((item) => item.id === activeAddress)) setActiveAddress(saved[0]?.id || 'home')
  }, [loading, account])

  const selectedAddress = useMemo(() => addresses.find((item) => item.id === activeAddress) || addresses[0], [addresses, activeAddress])
  const profileChanged = JSON.stringify({ form, addresses }) !== savedProfile.current

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('')
    const savedAddressId = activeAddress
    const incomplete = isCustomer ? addresses.find((item) => (item.latitude != null || item.longitude != null) && (item.latitude == null || item.longitude == null || !item.house_number?.trim() || !item.road?.trim() || !item.area?.trim() || !item.city?.trim() || !(item.pincode || item.postal_code)?.trim())) : undefined
    if (incomplete) {
      setActiveAddress(incomplete.id)
      setError(`Complete the house or flat, road, area, city, and PIN code for ${incomplete.label}. Landmark is optional.`)
      return
    }
    setBusy(true)
    const normalized = isCustomer ? addresses.map(({ postal_code, ...item }) => ({ ...item, pincode: item.pincode || postal_code || '' })) : undefined
    try {
      const updated = await api<Account>('/auth/profile', { method: 'PATCH', body: JSON.stringify({ ...form, phone: form.phone || null, ...(normalized ? { addresses: normalized } : {}) }) })
      updateAccount(updated); setForm({ name: updated.name, email: updated.email, phone: updated.phone || '' }); if (isCustomer) setAddresses(updated.addresses)
      savedProfile.current = JSON.stringify({ form: { name: updated.name, email: updated.email, phone: updated.phone || '' }, addresses: isCustomer ? updated.addresses : addresses })
      if (updated.addresses.some((item) => item.id === savedAddressId)) setActiveAddress(savedAddressId)
      setNotice(isCustomer ? 'Profile and saved addresses updated.' : 'Profile updated.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save your profile.') }
    finally { setBusy(false) }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.new_password !== password.confirm) { setError('The new passwords do not match.'); return }
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

  if (loading) return <main className="customer-page profile-page"><Loading label="Loading your profile…" /></main>
  return <main className="customer-page profile-page">
    <PageTitle eyebrow={`${account?.role || 'YOUR'} KEBABZILLA ACCOUNT`} title="Edit profile" description="Update your personal details and password." action={<Link className="button button-secondary" to={account && account.role !== 'USER' ? homeForProfile(account.role) : '/'}><ArrowLeft size={15} /> Back</Link>} />
    {error && <Notice onDismiss={() => setError('')}>{error}</Notice>}
    {notice && <Notice tone="success" onDismiss={() => setNotice('')}>{notice}</Notice>}
    <form className="profile-card" onSubmit={(event) => void saveProfile(event)}>
      <div className="profile-card-heading"><h2>Personal details</h2></div>
      <div className="profile-form-grid">
        <label className="field-label"><span>Name <sup className="field-required">*</sup></span><input required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="field-label"><span>Email address <sup className="field-required">*</sup></span><input required type="email" maxLength={255} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label className="field-label"><span>Mobile number <sup className="field-required">*</sup></span><input required type="tel" maxLength={32} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
      </div>
      {isCustomer && <><div className="profile-card-heading profile-address-heading"><span><h2>Saved addresses</h2><small>Select a tab to edit that address. Home and Work are included by default.</small></span><Button type="button" variant="secondary" onClick={addAddress}><Plus size={15} /> Add address</Button></div>
      <div className="address-tabs" role="tablist" aria-label="Saved addresses">{addresses.map((item) => <button type="button" role="tab" aria-selected={selectedAddress?.id === item.id} className={`address-tab ${selectedAddress?.id === item.id ? 'active' : ''}`} key={item.id} onClick={() => setActiveAddress(item.id)}>{item.label}{item.is_default && <Star size={12} fill="currentColor" />}</button>)}</div>
      {selectedAddress && <article className="saved-address-card" key={selectedAddress.id}>
        <div className="saved-address-title"><label className="field-label"><span>Address name <sup className="field-required">*</sup></span><input required maxLength={40} value={selectedAddress.label} onChange={(event) => editAddress(selectedAddress.id, { label: event.target.value })} /></label><div className="address-card-actions">{!selectedAddress.is_default && <button className="text-button address-default-button" type="button" onClick={() => setDefaultAddress(selectedAddress.id)}><Star size={14} /> Set as default</button>}{selectedAddress.id !== 'home' && selectedAddress.id !== 'work' && <button className="icon-button danger-icon" type="button" aria-label="Delete address" title="Delete address" onClick={() => { let remaining = addresses.filter((item) => item.id !== selectedAddress.id); if (!remaining.some((item) => item.is_default) && remaining.length) remaining = remaining.map((item, index) => ({ ...item, is_default: index === 0 })); setAddresses(remaining); setActiveAddress(remaining[0]?.id || 'home') }}><Trash2 size={16} /></button>}</div></div>
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
      </>}
      {profileChanged && <div className="profile-save-row"><Button type="submit" disabled={busy}><Save size={15} /> {busy ? 'Saving…' : isCustomer ? 'Save profile & address' : 'Save profile'}</Button></div>}
    </form>
    <form className="profile-card password-card" onSubmit={(event) => void changePassword(event)}>
      <div className="profile-card-heading"><h2>Change password</h2><span>At least 10 characters for the new password.</span></div>
      <div className="profile-form-grid">
        <label className="field-label"><span>Current password <sup className="field-required">*</sup></span><input required type="password" autoComplete="current-password" value={password.current_password} onChange={(event) => setPassword({ ...password, current_password: event.target.value })} /></label>
        <label className="field-label"><span>New password <sup className="field-required">*</sup></span><input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={password.new_password} onChange={(event) => setPassword({ ...password, new_password: event.target.value })} /></label>
        <label className="field-label"><span>Confirm new password <sup className="field-required">*</sup></span><input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={password.confirm} onChange={(event) => setPassword({ ...password, confirm: event.target.value })} /></label>
      </div>
      <div className="profile-save-row"><Button type="submit" variant="secondary" disabled={busy}><Check size={15} /> Update password</Button></div>
    </form>
    {isCustomer && mapAddress && addresses.find((item) => item.id === mapAddress) && <AddressMap address={addresses.find((item) => item.id === mapAddress)!} onClose={() => setMapAddress(null)} onSave={(latitude, longitude, parts) => { editAddress(mapAddress, { ...parts, latitude, longitude }); setEditingAddress(mapAddress) }} />}
  </main>
}
