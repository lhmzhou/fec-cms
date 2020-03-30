from django import template

from django.conf import settings
from data import constants, utils

register = template.Library()


@register.inclusion_tag('partials/elections-lookup.html')
def elections_lookup(request):

    cycle = constants.DEFAULT_ELECTION_YEAR
    cycles = utils.get_cycles(cycle + 4)
    FEATURES = settings.FEATURES  # noqa
    states = constants.states

    return {
        'parent': 'data',
        'cycles': cycles,
        'cycle': cycle,
        'states': states,
        'FEATURES': FEATURES,
    }
