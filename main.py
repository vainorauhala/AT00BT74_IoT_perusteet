# VESIVUODON VALVONTAJÄRJESTELMÄ

import machine  
import time     
import dht      
import network   
import urequests 

# ------ ASETUKSET --------

WIFI_SSID = '***********'
WIFI_PASSWORD = "*****************"

THINGSPEAK_WRITE_KEY = "*******************" 
THINGSPEAK_URL = "https://api.thingspeak.com/update"

# Raja-arvot
LAMPOTILA_RAJA = 30      # celsiusastetta
KOSTEUS_RAJA = 70        # prosenttia
VESI_RAJA = 20000      # kalibroitu mutta ei tarkasti
MITTAUSVALI = 30         # sekuntia


# --------- PINNIT -----

dht_sensor = dht.DHT22(machine.Pin(0))
vesi_signaali = machine.ADC(machine.Pin(26))
vesi_virta = machine.Pin(15, machine.Pin.OUT)
led_vihrea = machine.Pin(2, machine.Pin.OUT)     # Tila OK
led_keltainen = machine.Pin(3, machine.Pin.OUT)  # Anturivirhe / ei luettavissa
led_punainen = machine.Pin(4, machine.Pin.OUT)   # Hälytys


def sammuta_ledit():
    """Sammuttaa kaikki kolme LEDiä. Kutsutaan aina ennen uutta
    tilan päättelyä, jotta edellisen kierroksen LED ei jää turhaan
    palamaan uuden tilan päälle."""
    led_vihrea.value(0)
    led_keltainen.value(0)
    led_punainen.value(0)


def yhdista_wifi():
    """Yhdistää kotiverkon WiFihin."""
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(WIFI_SSID, WIFI_PASSWORD)

    print("Yhdistetään WiFiin...")
    yritykset = 0
    while not wlan.isconnected() and yritykset < 20:
        time.sleep(0.5)
        yritykset += 1

    if wlan.isconnected():
        print("WiFi yhdistetty:", wlan.ifconfig())
        return True
    else:
        print("WiFi-yhteys epäonnistui")
        return False


def lue_vesianturi():
    """Kytkee virran päälle vain
    juuri mittauksen ajaksi ja sammuttaa sen heti perään."""
    vesi_virta.value(1)      
    time.sleep_ms(50)           
    arvo = vesi_signaali.read_u16()  # Lue ADC-arvo 
    vesi_virta.value(0)          # Virta heti pois
    return arvo


def lue_dht():
    """Kokeillaan useampi mittaus koska välillä antaa outoa lukemaa"""
    try:
        dht_sensor.measure()  
        lampotila = dht_sensor.temperature()
        kosteus = dht_sensor.humidity()
        return lampotila, kosteus
    except Exception as e:
        # Tulostetaan virhe debuggausta varten
        print("DHT-lukuvirhe:", e)
        return None, None
def laheta_thingspeakiin(lampotila, kosteus, vesi_arvo, halytys):
    """Lähettää datan ThingSpeakille"""
    try:
        data = 'api_key={}&field1={}&field2={}&field3={}&field4={}'.format(
            THINGSPEAK_WRITE_KEY, lampotila, kosteus, vesi_arvo, int(halytys)
        )
        vastaus = urequests.post(
            THINGSPEAK_URL,
            data=data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        print("ThingSpeak-vastaus:", vastaus.text)
        vastaus.close()
    except Exception as e:
        print("Lähetysvirhe:", e)


# PÄÄOHJELMA

# Yritetään WiFi-yhteyttä heti alussa. 
if not yhdista_wifi():
    sammuta_ledit()
    led_keltainen.value(1)

#hälyt
while True:
    lampotila, kosteus = lue_dht()
    vesi_arvo = lue_vesianturi()

    sammuta_ledit()  # Nollataan tila ennen uutta päättelyä

    if lampotila is None or kosteus is None:
        led_keltainen.value(1)
    else:
        vesikosketus = vesi_arvo > VESI_RAJA
        raja_ylitys = (lampotila > LAMPOTILA_RAJA) or (kosteus > KOSTEUS_RAJA)

        if vesikosketus or raja_ylitys:
            led_punainen.value(1)
            halytys = True
        else:
            led_vihrea.value(1)
            halytys = False

        # livenä seuraamiseen VS Codessa 
        print(f"Lämpötila: {lampotila}C  Kosteus: {kosteus}%  Vesi: {vesi_arvo}  Hälytys: {halytys}")

        laheta_thingspeakiin(lampotila, kosteus, vesi_arvo, halytys)

    # Odotetaan seuraavaan mittaukseen.
    time.sleep(MITTAUSVALI)